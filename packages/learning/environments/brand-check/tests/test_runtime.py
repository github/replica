"""Customer-operated training and serving through the local runtime."""

from __future__ import annotations

import base64
import json
import multiprocessing
import os
import shutil
import signal
import socket
import stat
import sys
import threading
import time
import unittest
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from multiprocessing.util import Finalize
from pathlib import Path
from unittest import mock
from urllib import error, request

import replica_brand_check.runtime as runtime_module
import replica_brand_check.runtime_server as runtime_server_module
from replica_brand_check.connectors import (
    ConnectorError,
    Credential,
    RuntimeScope,
    TrainingResult,
    Usage,
)
from replica_brand_check.runtime import (
    TASKSET_CACHE_LIMIT,
    FixtureBackend,
    LocalRuntime,
    RuntimeFailure,
)
from replica_brand_check.runtime_server import RuntimeHTTPServer, runtime_token
from replica_brand_check.taskset import MAX_IMAGE_BYTES
from tests.support import PNG, RULE, make_task, taskset_upload, write_taskset

TOKEN = "runtime-test-token-with-32-characters"


class FailingBackend(FixtureBackend):
    """A backend that fails after the runtime has accepted its job."""

    def train(self, *args, **kwargs):
        raise RuntimeError("provider secret: backend-token")


class ConnectorFailingBackend(FixtureBackend):
    """A backend that raises a connector-classified failure in the worker."""

    def train(self, *args, **kwargs):
        raise ConnectorError(
            "provider_unavailable",
            "provider secret: connector-token",
            category="unavailable",
            retryable=True,
        )


class SlowBackend(FixtureBackend):
    """A backend that ignores its deadline, to prove the runtime still bounds the job."""

    def train(self, *args, **kwargs):
        time.sleep(2)
        return super().train(*args, **kwargs)


class SlowInferenceBackend(FixtureBackend):
    """A backend that ignores the inference timeout supplied by the compatibility adapter."""

    def predict(self, *args, **kwargs):
        time.sleep(0.1)
        return super().predict(*args, **kwargs)


class FailingInferenceBackend(FixtureBackend):
    """A backend that exposes an unexpected provider failure during inference."""

    def predict(self, *args, **kwargs):
        raise RuntimeError("provider secret: inference-token")


class LingeringBackend(FixtureBackend):
    """A backend that returns but leaves its child process unable to exit."""

    def train(self, *args, **kwargs):
        Finalize(None, time.sleep, args=(30,), exitpriority=0)
        return super().train(*args, **kwargs)


class CrashingBackend(FixtureBackend):
    """A backend that exits without returning a result."""

    def train(self, *args, **kwargs):
        os._exit(7)


class UnknownCalibrationBackend(FixtureBackend):
    """A backend whose public candidate report has no calibration evidence."""

    def train(self, *args, **kwargs):
        result = super().train(*args, **kwargs)
        baseline = json.loads(json.dumps(result.baseline_report))
        candidate = json.loads(json.dumps(result.candidate_report))
        baseline["noul"]["ece"] = None
        candidate["noul"]["ece"] = None
        return TrainingResult(
            adapter_name=result.adapter_name,
            adapter=result.adapter,
            baseline_report=baseline,
            candidate_report=candidate,
            metadata=result.metadata,
            updates_completed=result.updates_completed,
        )


class BlockingBackend(FixtureBackend):
    """A backend whose first job waits so a second job stays queued during close."""

    def __init__(self, started: Path, release: Path):
        self.started = started
        self.release = release

    def train(self, *args, **kwargs):
        self.started.write_text("started", encoding="utf-8")
        deadline = time.monotonic() + 5
        while not self.release.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        return super().train(*args, **kwargs)


class CancellableBackend(FixtureBackend):
    """A backend that stays alive until cancellation terminates its worker."""

    def __init__(self, started: Path, release: Path):
        self.started = started
        self.release = release

    def train(self, *args, **kwargs):
        self.started.write_text("started", encoding="utf-8")
        while not self.release.exists():
            time.sleep(0.01)
        return super().train(*args, **kwargs)


class CooperativeCancellationBackend(FixtureBackend):
    """A hosted-style connector that records cancellation inside the worker."""

    def __init__(self, started: Path, cancelled: Path):
        self.started = started
        self.cancelled = cancelled

    def train_with_context(self, *args, **kwargs):
        context = kwargs["context"]
        self.started.write_text("started", encoding="utf-8")
        while not context.cancellation.requested:
            time.sleep(0.01)
        self.cancelled.write_text("cancelled", encoding="utf-8")
        context.cancellation.raise_if_requested()


class CapturingBackend(FixtureBackend):
    """A fixture backend that records the projected inference request."""

    def __init__(self, capture: Path):
        self.capture = capture

    def predict(self, adapter, request, *, timeout_seconds):
        self.capture.write_text(json.dumps(request), encoding="utf-8")
        return super().predict(adapter, request, timeout_seconds=timeout_seconds)


class PartialBackend(FixtureBackend):
    """A backend that reports fewer completed updates than its budget."""

    def train(self, *args, **kwargs):
        return replace(super().train(*args, **kwargs), updates_completed=2)


class UnsupportedBudgetBackend(FixtureBackend):
    """A local backend that can run only when the caller opts out of metering."""

    name = "unsupported-budget"
    supports_hard_credit_budget = False


class OverBudgetBackend(FixtureBackend):
    """A connector that claims hard-budget support but reports excess usage."""

    name = "over-budget"

    def train(self, *args, **kwargs):
        return replace(
            super().train(*args, **kwargs),
            updates_completed=kwargs["max_updates"] + 1,
        )


class CapturingCredentials:
    def __init__(self):
        self.calls = []

    def acquire(self, audience, context):
        self.calls.append((audience, context))
        return Credential(
            value=f"{audience}-credential",
            expires_at=context.deadline,
            audience=audience,
            scope=context.scope,
            operation_id=context.operation_id,
        )


class CapturingObservability:
    def __init__(self):
        self.records = []

    def record(self, usage, context):
        self.records.append((usage, context))


class BlockingObservability(CapturingObservability):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def record(self, usage, context):
        self.started.set()
        if not self.release.wait(5):
            raise AssertionError("usage reporting was not released")
        super().record(usage, context)


class FailingObservability:
    def record(self, usage, context):
        del usage, context
        raise ConnectorError(
            "usage_unavailable",
            "provider secret: test-token",
            category="unavailable",
            retryable=True,
        )


class InferenceFailingCredentials(CapturingCredentials):
    def acquire(self, audience, context):
        if audience == "inference":
            raise ConnectorError(
                "credential_unavailable",
                "provider secret: test-token",
                category="unauthorized",
            )
        return super().acquire(audience, context)


class TrainingFailingCredentials(CapturingCredentials):
    def acquire(self, audience, context):
        if audience == "training":
            raise ConnectorError(
                "credential_unavailable",
                "provider secret: training-token",
                category="unauthorized",
            )
        return super().acquire(audience, context)


class LocalRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.taskset_dir = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, answer=True),
                make_task(3, split="test", answer=True),
                make_task(4, split="test", answer=True),
            ],
        )
        self.state_dir = self.taskset_dir.parent / f"{self.taskset_dir.name}-state"
        self.addCleanup(self._remove_state)

    def test_trains_immutable_candidate_then_requires_promotion_to_serve_it(self):
        runtime = self._runtime()

        submitted = runtime.submit(
            backend="fixture", max_updates=8, max_seconds=5, max_credits=8
        )
        self.assertEqual(submitted["state"], "queued")
        finished = self._wait_for_job(runtime, submitted["id"])
        self.assertEqual(finished["state"], "succeeded")
        candidate_id = finished["candidateId"]

        candidate = runtime.candidate(candidate_id)
        manifest, report = self._candidate_documents(candidate)
        self.assertEqual(manifest["id"], candidate_id)
        self.assertFalse(manifest["productionEligible"])
        self.assertGreater(report["evidence"]["meanRewardDelta"], 0)
        self.assertIn("calibrationErrorDelta", report["evidence"])
        before = self._candidate_snapshot(candidate)
        candidate["manifest"]["backend"] = "tampered"
        self.assertEqual(self._candidate_snapshot(runtime.candidate(candidate_id)), before)
        for artifact in (self.state_dir / "candidates" / candidate_id).iterdir():
            self.assertEqual(artifact.stat().st_mode & 0o222, 0)

        promotion = runtime.promote(
            candidate_id,
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-first-candidate",
        )
        self.assertEqual(promotion["candidateId"], candidate_id)
        response = runtime.evaluate(self._request())

        self.assertEqual(response["candidateId"], candidate_id)
        self.assertIn("schemaVersion", response)
        self.assertIn(RULE, response["answers"])
        self.assertEqual(response["evaluations"][0]["learningId"], RULE)
        self.assertEqual(self._candidate_snapshot(runtime.candidate(candidate_id)), before)

        before_rollback = runtime.promotion()
        with self.assertRaises(RuntimeFailure) as unavailable:
            runtime.rollback(
                rolled_back_by="test-operator",
                expected_generation=1,
                idempotency_key="rollback-without-history",
            )
        self.assertEqual(unavailable.exception.code, "rollback_unavailable")
        self.assertEqual(runtime.promotion(), before_rollback)

    def test_refuses_inference_until_a_candidate_is_explicitly_promoted(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=2, max_seconds=5, max_credits=2
            )["id"],
        )
        self.assertEqual(finished["state"], "succeeded")

        with self.assertRaises(RuntimeFailure) as not_promoted:
            runtime.evaluate(self._request())
        self.assertEqual(not_promoted.exception.code, "candidate_not_promoted")

    def test_backend_receives_no_free_form_task_or_question_text(self):
        capture = self.taskset_dir.parent / "captured-request.json"
        backend = CapturingBackend(capture)
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": backend},
            environment="test",
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-capturing-backend",
        )
        runtime.evaluate(self._request())

        self.assertEqual(
            json.loads(capture.read_text(encoding="utf-8")),
            {
                "images": [
                    "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
                ],
                "questions": {RULE: {"type": "noul"}},
                "expectedGeneration": 1,
            },
        )

    def test_passes_scoped_operation_context_to_credentials_and_usage_reporting(self):
        credentials = CapturingCredentials()
        observability = CapturingObservability()
        scope = RuntimeScope("tenant-one", "github/example")
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            scope=scope,
            credentials=credentials,
            observability=observability,
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-context-test",
        )
        response = runtime.evaluate(self._request())

        self.assertEqual(response["candidateId"], finished["candidateId"])
        self.assertEqual(
            [audience for audience, _ in credentials.calls],
            ["training", "inference"],
        )
        self.assertTrue(all(context.scope == scope for _, context in credentials.calls))
        self.assertEqual(
            [usage.kind for usage, _ in observability.records],
            ["training_credits", "inference_seconds"],
        )
        self.assertTrue(
            all(
                usage.scope == scope
                and usage.operation_id == context.operation_id
                and context.scope == scope
                for usage, context in observability.records
            )
        )

    def test_persists_connector_reported_usage_and_credit_budget_across_restart(self):
        observability = CapturingObservability()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"partial": PartialBackend()},
            environment="test",
            observability=observability,
        )
        self.addCleanup(runtime.close)

        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="partial", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )

        self.assertEqual(finished["state"], "succeeded")
        self.assertEqual(
            finished["limits"],
            {
                "maxUpdates": 8,
                "maxSeconds": 5.0,
                "maxCredits": 8.0,
                "budgetMode": "hard",
            },
        )
        self.assertEqual(
            finished["usage"],
            [
                {
                    "connector": "fixture",
                    "kind": "training_credits",
                    "quantity": 2.0,
                    "unit": "credits",
                    "cost": 0.0,
                    "currency": "USD",
                    "source": "local-training-connector",
                    "metadata": {
                        "updatesCompleted": 2,
                        "requestedUpdates": 8,
                        "budgetMode": "hard",
                    },
                }
            ],
        )
        candidate = runtime.candidate(finished["candidateId"])
        self.assertEqual(candidate["manifest"]["usage"], finished["usage"])
        usage, _context = observability.records[0]
        self.assertEqual(usage.quantity, 2)
        self.assertEqual(usage.unit, "credits")
        self.assertEqual(usage.cost, 0)
        self.assertEqual(usage.currency, "USD")
        self.assertEqual(usage.source, "local-training-connector")
        self.assertEqual(usage.metadata["requestedUpdates"], 8)
        runtime.close()

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"partial": PartialBackend()},
            environment="test",
        )
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.job(finished["id"]), finished)
        self.assertEqual(
            reopened.candidate(finished["candidateId"])["manifest"]["usage"],
            finished["usage"],
        )

    def test_job_reports_same_kind_usage_with_distinct_retry_keys(self):
        observability = CapturingObservability()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            observability=observability,
        )
        self.addCleanup(runtime.close)
        def two_records(*args, context, **kwargs):
            del args, kwargs
            result = FixtureBackend().train(
                runtime.taskset,
                self.state_dir,
                max_updates=2,
                deadline=time.monotonic() + 5,
            )
            usage = tuple(
                Usage(
                    context.operation_id,
                    context.scope,
                    "fixture",
                    "training_credits",
                    1,
                    "credits",
                    0,
                    "USD",
                    {"part": index},
                    "test",
                )
                for index in range(2)
            )
            return replace(result, usage=usage)

        with mock.patch(
            "replica_brand_check.runtime._run_backend",
            side_effect=two_records,
        ):
            finished = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture",
                    max_updates=2,
                    max_seconds=5,
                    max_credits=2,
                )["id"],
            )

        self.assertEqual(finished["state"], "succeeded")
        self.assertEqual(
            [record_context.idempotency_key for _, record_context in observability.records],
            [
                f"{finished['id']}:usage:0:training_credits",
                f"{finished['id']}:usage:1:training_credits",
            ],
        )

    def test_rejects_unsupported_hard_budget_before_creating_a_job(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"unsupported-budget": UnsupportedBudgetBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        with self.assertRaises(RuntimeFailure) as unsupported:
            runtime.submit(
                backend="unsupported-budget",
                max_updates=2,
                max_seconds=5,
                max_credits=2,
            )

        self.assertEqual(unsupported.exception.code, "hard_budget_unsupported")
        self.assertEqual(list((self.state_dir / "jobs").glob("*.json")), [])
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])

        submitted = runtime.submit(
            backend="unsupported-budget",
            max_updates=2,
            max_seconds=5,
            max_credits=2,
            budget_mode="unmetered_local",
        )
        self.assertEqual(
            self._wait_for_job(runtime, submitted["id"])["state"],
            "succeeded",
        )

    def test_budget_violation_fails_closed_without_a_candidate(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"over-budget": OverBudgetBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="over-budget",
                max_updates=4,
                max_seconds=5,
                max_credits=1,
            )["id"],
        )
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["error"]["code"], "credit_budget_exceeded")
        self.assertNotIn("candidateId", failed)
        self.assertEqual(failed["usage"][0]["quantity"], 2)
        self.assertEqual(failed["usage"][0]["unit"], "credits")
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertIsNone(runtime.promotion(required=False))

    def test_production_rejects_unmetered_training_before_creating_a_job(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"unsupported-budget": UnsupportedBudgetBackend()},
            environment="production",
        )
        self.addCleanup(runtime.close)

        with self.assertRaises(RuntimeFailure) as forbidden:
            runtime.submit(
                backend="unsupported-budget",
                max_updates=2,
                max_seconds=5,
                max_credits=2,
                budget_mode="unmetered_local",
            )

        self.assertEqual(forbidden.exception.code, "unmetered_budget_forbidden")
        self.assertEqual(forbidden.exception.status, 409)
        self.assertEqual(list((self.state_dir / "jobs").glob("*.json")), [])

    def test_preserves_job_failure_when_usage_reporting_also_fails(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"over-budget": OverBudgetBackend()},
            environment="test",
            observability=FailingObservability(),
        )
        self.addCleanup(runtime.close)

        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="over-budget", max_updates=2, max_seconds=5, max_credits=1
            )["id"],
        )
        failed = self._wait_for_usage_error(runtime, failed["id"])

        self.assertEqual(failed["error"]["code"], "credit_budget_exceeded")
        self.assertEqual(failed["usageError"]["code"], "usage_unavailable")
        self.assertEqual(failed["usageError"]["message"], "Connector operation failed.")
        self.assertEqual(failed["usage"][0]["quantity"], 2)

    def test_preserves_successful_candidate_when_usage_reporting_fails(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            observability=FailingObservability(),
        )
        self.addCleanup(runtime.close)

        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        finished = self._wait_for_usage_error(runtime, finished["id"])

        self.assertEqual(finished["state"], "succeeded")
        self.assertIn("candidateId", finished)
        self.assertEqual(finished["usageError"]["code"], "usage_unavailable")
        self.assertEqual(
            finished["usageError"]["message"],
            "Connector operation failed.",
        )
        self.assertEqual(
            runtime.candidate(finished["candidateId"])["manifest"]["id"],
            finished["candidateId"],
        )

    def test_persists_terminal_success_before_exporting_usage(self):
        observability = BlockingObservability()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            observability=observability,
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(
            backend="fixture",
            max_updates=2,
            max_seconds=5,
            max_credits=2,
        )
        self.assertTrue(observability.started.wait(5))
        durable = runtime.job(submitted["id"])
        observability.release.set()
        finished = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(durable["state"], "succeeded")
        self.assertIn("candidateId", durable)
        self.assertEqual(finished["state"], "succeeded")

    def test_timeout_without_a_connector_result_records_no_usage(self):
        observability = CapturingObservability()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"slow": SlowBackend()},
            environment="test",
            observability=observability,
        )
        self.addCleanup(runtime.close)

        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="slow", max_updates=1, max_seconds=1, max_credits=1
            )["id"],
        )

        self.assertEqual(failed["error"]["code"], "job_timed_out")
        self.assertEqual(observability.records, [])
        self.assertNotIn("usage", failed)

    def test_fails_closed_when_deadline_result_has_no_authoritative_usage(self):
        runtime = self._runtime()
        result = FixtureBackend().train(
            runtime.taskset,
            self.state_dir,
            max_updates=2,
            deadline=time.monotonic() + 5,
        )

        def finish_at_deadline(*args, context, **kwargs):
            del args, kwargs
            while time.monotonic() < context.deadline:
                time.sleep(0.001)
            return result

        with mock.patch(
            "replica_brand_check.runtime._run_backend",
            side_effect=finish_at_deadline,
        ):
            finished = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture", max_updates=2, max_seconds=1, max_credits=2
                )["id"],
            )

        self.assertEqual(finished["state"], "failed")
        self.assertEqual(finished["error"]["code"], "usage_missing")
        self.assertNotIn("candidateId", finished)
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])

    def test_fails_closed_when_connector_usage_omits_billed_cost(self):
        runtime = self._runtime()
        result = FixtureBackend().train(
            runtime.taskset,
            self.state_dir,
            max_updates=2,
            deadline=time.monotonic() + 5,
        )

        def missing_cost(*args, context, **kwargs):
            del args, kwargs
            return replace(
                result,
                usage=(
                    Usage(
                        context.operation_id,
                        context.scope,
                        "fixture",
                        "training_credits",
                        2,
                        "credits",
                        source="missing-cost-test",
                    ),
                ),
            )

        with mock.patch(
            "replica_brand_check.runtime._run_backend",
            side_effect=missing_cost,
        ):
            failed = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture",
                    max_updates=2,
                    max_seconds=5,
                    max_credits=2,
                )["id"],
            )

        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["error"]["code"], "usage_invalid")
        self.assertNotIn("candidateId", failed)

    def test_persists_success_when_connector_usage_arrives_at_the_training_deadline(self):
        runtime = self._runtime()
        result = FixtureBackend().train(
            runtime.taskset,
            self.state_dir,
            max_updates=2,
            deadline=time.monotonic() + 5,
        )

        def finish_at_deadline(*args, context, **kwargs):
            del args, kwargs
            while time.monotonic() < context.deadline:
                time.sleep(0.001)
            return replace(
                result,
                usage=(
                    Usage(
                        context.operation_id,
                        context.scope,
                        "fixture",
                        "training_credits",
                        2,
                        "credits",
                        0,
                        "USD",
                        {},
                        "fixture-deadline-test",
                    ),
                ),
            )

        with mock.patch(
            "replica_brand_check.runtime._run_backend",
            side_effect=finish_at_deadline,
        ):
            finished = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture", max_updates=2, max_seconds=1, max_credits=2
                )["id"],
            )

        self.assertEqual(finished["state"], "succeeded")
        self.assertEqual(finished["usage"][0]["source"], "fixture-deadline-test")
        self.assertIn("candidateId", finished)

    def test_maps_runtime_credential_failure_to_service_unavailable(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            credentials=InferenceFailingCredentials(),
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-credential-test",
        )

        with self.assertRaises(RuntimeFailure) as unavailable:
            runtime.evaluate(self._request())

        self.assertEqual(unavailable.exception.code, "credential_unavailable")
        self.assertEqual(unavailable.exception.status, 503)
        self.assertEqual(str(unavailable.exception), "Connector operation failed.")
        self.assertNotIn("test-token", str(unavailable.exception))

    def test_redacts_training_credential_failure_from_the_job_record(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            credentials=TrainingFailingCredentials(),
        )
        self.addCleanup(runtime.close)

        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )

        self.assertEqual(failed["error"]["code"], "credential_unavailable")
        self.assertEqual(failed["error"]["message"], "Connector operation failed.")
        self.assertNotIn("training-token", failed["error"]["message"])

    def test_redacts_connector_failure_from_the_training_worker_result(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"connector-failure": ConnectorFailingBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="connector-failure",
                max_updates=8,
                max_seconds=5,
                max_credits=8,
            )["id"],
        )

        self.assertEqual(failed["error"]["code"], "provider_unavailable")
        self.assertEqual(failed["error"]["message"], "Connector operation failed.")
        self.assertNotIn("connector-token", failed["error"]["message"])

    def test_redacts_unexpected_inference_worker_failure(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"inference-failure": FailingInferenceBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="inference-failure",
                max_updates=8,
                max_seconds=5,
                max_credits=8,
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-failing-inference",
        )

        with self.assertRaises(RuntimeFailure) as failed:
            runtime.evaluate(self._request())

        self.assertEqual(failed.exception.code, "inference_failed")
        self.assertEqual(str(failed.exception), "Inference operation failed.")
        self.assertNotIn("inference-token", str(failed.exception))

    def test_detects_a_candidate_changed_to_claim_production_eligibility(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        manifest_path = (
            self.state_dir / "candidates" / finished["candidateId"] / "manifest.json"
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["productionEligible"] = True
        manifest_path.chmod(0o600)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with self.assertRaises(RuntimeFailure) as damaged:
            runtime.candidate(finished["candidateId"])

        self.assertEqual(damaged.exception.code, "candidate_damaged")

    def test_rejects_invalid_limits_without_persisting_a_job(self):
        runtime = self._runtime()
        before = self._tree_snapshot(self.state_dir)

        invalid_limits = (
            {"max_updates": 0, "max_seconds": 1},
            {"max_updates": -1, "max_seconds": 1},
            {"max_updates": 1, "max_seconds": 0},
            {"max_updates": 1, "max_seconds": -1},
            {"max_updates": 10**12, "max_seconds": 1},
            {"max_updates": 1, "max_seconds": 10**12},
            {"max_updates": 1, "max_seconds": 10**1000},
        )
        for limits in invalid_limits:
            with self.subTest(**limits):
                with self.assertRaises(ValueError):
                    runtime.submit(backend="fixture", max_credits=8, **limits)

        self.assertEqual(self._tree_snapshot(self.state_dir), before)

        with self.assertRaises(RuntimeFailure) as oversized_credits:
            runtime.submit(
                backend="fixture",
                max_updates=1,
                max_seconds=1,
                max_credits=10**1000,
            )
        self.assertEqual(oversized_credits.exception.code, "invalid_limit")

    def test_refuses_an_empty_backend_configuration(self):
        with self.assertRaises(RuntimeFailure) as missing:
            LocalRuntime(self.state_dir, self.taskset_dir, backends={})

        self.assertEqual(missing.exception.code, "backend_missing")

    def test_refuses_a_non_string_backend_as_invalid_input(self):
        runtime = self._runtime()

        with self.assertRaises(RuntimeFailure) as invalid:
            runtime.submit(
                backend={"fixture": True},
                max_updates=1,
                max_seconds=1,
                max_credits=1,
            )

        self.assertEqual(invalid.exception.code, "invalid_input")
        self.assertEqual(invalid.exception.status, 400)

    def test_submit_reuses_one_job_for_the_same_idempotency_key(self):
        runtime = self._runtime()

        first = runtime.submit(
            backend="fixture",
            max_updates=8,
            max_seconds=5,
            max_credits=8,
            idempotency_key="same-submission",
        )
        second = runtime.submit(
            backend="fixture",
            max_updates=8,
            max_seconds=5,
            max_credits=8,
            idempotency_key="same-submission",
        )

        self.assertEqual(second["id"], first["id"])

    def test_concurrent_submit_enqueues_one_idempotent_job(self):
        runtime = self._runtime()

        def submit():
            return runtime.submit(
                backend="fixture",
                max_updates=8,
                max_seconds=5,
                max_credits=8,
                idempotency_key="concurrent-submission",
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: submit(), range(2)))

        self.assertEqual(results[0]["id"], results[1]["id"])
        self._wait_for_job(runtime, results[0]["id"])
        self.assertEqual(len(list((self.state_dir / "candidates").iterdir())), 1)

    def test_refuses_a_second_runtime_without_changing_the_first_jobs(self):
        runtime = self._runtime()
        submitted = runtime.submit(
            backend="fixture", max_updates=8, max_seconds=5, max_credits=8
        )

        with self.assertRaises(RuntimeFailure) as in_use:
            LocalRuntime(self.state_dir, self.taskset_dir)

        self.assertEqual(in_use.exception.code, "runtime_in_use")
        self.assertNotEqual(runtime.job(submitted["id"])["state"], "failed")

    def test_marks_a_backend_that_exceeds_the_wall_time_failed(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"slow": SlowBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(
            backend="slow", max_updates=1, max_seconds=1, max_credits=1
        )
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["error"]["code"], "job_timed_out")
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertEqual(multiprocessing.active_children(), [])

    def test_bounds_inference_when_a_connector_ignores_its_deadline(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"slow": SlowInferenceBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="slow", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-slow-inference",
        )

        with self.assertRaises(RuntimeFailure) as timed_out:
            runtime.evaluate(self._request(), timeout_seconds=0.01)

        self.assertEqual(timed_out.exception.code, "inference_timed_out")
        self.assertEqual(timed_out.exception.status, 504)
        self.assertEqual(multiprocessing.active_children(), [])
        self.assertEqual(list((self.state_dir / "work").iterdir()), [])
        self.assertEqual(
            sorted(
                path.name
                for path in (
                    self.state_dir / "candidates" / finished["candidateId"]
                ).iterdir()
            ),
            [".candidate.json", "adapter.json", "evaluation.json", "manifest.json"],
        )

    def test_bounds_a_worker_that_returns_but_does_not_exit(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"lingering": LingeringBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(
            backend="lingering", max_updates=1, max_seconds=1, max_credits=1
        )
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["error"]["code"], "job_timed_out")
        self.assertEqual(multiprocessing.active_children(), [])

    def test_reports_a_worker_that_exits_without_a_result(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"crashing": CrashingBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(
            backend="crashing", max_updates=1, max_seconds=5, max_credits=1
        )
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["error"]["code"], "backend_failed")
        self.assertEqual(failed["error"]["message"], "Backend operation failed.")

    def test_close_cancels_queued_jobs_instead_of_starting_them(self):
        started = self.taskset_dir.parent / "blocking-started"
        release = self.taskset_dir.parent / "blocking-release"
        backend = BlockingBackend(started, release)
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"blocking": backend},
            environment="test",
        )
        first = runtime.submit(
            backend="blocking", max_updates=1, max_seconds=5, max_credits=1
        )
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())
        second = runtime.submit(
            backend="blocking", max_updates=1, max_seconds=5, max_credits=1
        )
        closing = threading.Thread(target=runtime.close)
        closing.start()
        time.sleep(0.05)
        release.write_text("release", encoding="utf-8")
        closing.join(2)
        self.assertFalse(closing.is_alive())
        self.assertEqual(runtime.job(first["id"])["state"], "succeeded")
        self.assertEqual(runtime.job(second["id"])["state"], "queued")

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"blocking": backend},
            environment="test",
        )
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.job(second["id"])["error"]["code"], "runtime_restarted")

    def test_taskset_digest_changes_when_question_content_changes(self):
        runtime = self._runtime()
        before = runtime.taskset_digest
        runtime.close()
        tasks_path = self.taskset_dir / "tasks.jsonl"
        tasks = [json.loads(line) for line in tasks_path.read_text(encoding="utf-8").splitlines()]
        tasks[0]["questions"][RULE]["instructions"] = "Changed question"
        tasks_path.write_text(
            "".join(json.dumps(task) + "\n" for task in tasks),
            encoding="utf-8",
        )

        reopened = self._runtime()

        self.assertNotEqual(reopened.taskset_digest, before)

    def test_queued_job_refuses_a_taskset_changed_after_submission(self):
        started = self.taskset_dir.parent / "taskset-job-started"
        release = self.taskset_dir.parent / "taskset-job-release"
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"blocking": BlockingBackend(started, release)},
            environment="test",
        )
        self.addCleanup(runtime.close)
        runtime.submit(
            backend="blocking", max_updates=1, max_seconds=5, max_credits=1
        )
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        queued = runtime.submit(
            backend="blocking", max_updates=1, max_seconds=5, max_credits=1
        )
        tasks_path = self.taskset_dir / "tasks.jsonl"
        tasks = [json.loads(line) for line in tasks_path.read_text(encoding="utf-8").splitlines()]
        tasks[0]["questions"][RULE]["instructions"] = "Changed after submission"
        tasks_path.write_text(
            "".join(json.dumps(task) + "\n" for task in tasks),
            encoding="utf-8",
        )
        release.write_text("release", encoding="utf-8")

        failed = self._wait_for_job(runtime, queued["id"])

        self.assertEqual(failed["error"]["code"], "taskset_changed")
        self.assertNotIn("candidateId", failed)

    def test_persists_backend_failure_without_creating_a_candidate(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"failed": FailingBackend()},
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(
            backend="failed", max_updates=1, max_seconds=5, max_credits=1
        )
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertNotIn("candidateId", failed)
        self.assertEqual(failed["error"]["message"], "Backend operation failed.")
        self.assertNotIn("backend-token", json.dumps(failed))
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertIsNone(runtime.promotion(required=False))
        runtime.close()
        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"failed": FailingBackend()},
        )
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.job(submitted["id"])["state"], "failed")
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertIsNone(reopened.promotion(required=False))

    def test_persists_work_directory_setup_failure(self):
        runtime = self._runtime()
        original = shutil.rmtree

        def fail_work(path, *args, **kwargs):
            if Path(path).parent.name == "work" and Path(path).name.startswith("job_"):
                raise OSError("work directory unavailable")
            return original(path, *args, **kwargs)

        with mock.patch("replica_brand_check.runtime.shutil.rmtree", side_effect=fail_work):
            submitted = runtime.submit(
                backend="fixture", max_updates=1, max_seconds=5, max_credits=1
            )
            failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["error"]["code"], "backend_failed")

    def test_restart_marks_an_interrupted_job_failed(self):
        jobs = self.state_dir / "jobs"
        jobs.mkdir(parents=True)
        job_id = "job_0123456789abcdef0123456789abcdef"
        (jobs / f"{job_id}.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "replica.decision-training-job/v1",
                    "id": job_id,
                    "state": "running",
                    "backend": "fixture",
                }
            ),
            encoding="utf-8",
        )

        runtime = self._runtime()
        recovered = runtime.job(job_id)

        self.assertEqual(recovered["state"], "failed")
        self.assertEqual(recovered["error"]["code"], "runtime_restarted")
        self.assertIn("completedAt", recovered)

    def test_rollback_promotes_the_previous_candidate_as_a_new_generation(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        first_candidate = first["candidateId"]
        second_candidate = second["candidateId"]
        self.assertNotEqual(first_candidate, second_candidate)

        first_promotion = runtime.promote(
            first_candidate,
            promoted_by="first-operator",
            expected_generation=0,
            idempotency_key="promote-first",
        )
        second_promotion = runtime.promote(
            second_candidate,
            promoted_by="second-operator",
            expected_generation=1,
            idempotency_key="promote-second",
        )
        repeated = runtime.promote(
            second_candidate,
            promoted_by="second-operator",
            expected_generation=1,
            idempotency_key="promote-second",
        )
        rollback = runtime.rollback(
            rolled_back_by="rollback-operator",
            expected_generation=2,
            idempotency_key="rollback-second",
        )

        self.assertEqual(first_promotion["generation"], 1)
        self.assertEqual(first_promotion["previousCandidateId"], None)
        self.assertEqual(first_promotion["operation"], "promote")
        self.assertEqual(second_promotion["generation"], 2)
        self.assertEqual(second_promotion["previousCandidateId"], first_candidate)
        self.assertEqual(repeated, second_promotion)
        self.assertEqual(rollback["generation"], 3)
        self.assertEqual(rollback["candidateId"], first_candidate)
        self.assertEqual(rollback["previousCandidateId"], second_candidate)
        self.assertEqual(rollback["operation"], "rollback")
        self.assertEqual(rollback["promotedBy"], "rollback-operator")
        self.assertEqual(
            [
                json.loads(path.read_text(encoding="utf-8"))
                for path in sorted((self.state_dir / "promotions").iterdir())
            ],
            [first_promotion, second_promotion, rollback],
        )
        candidate_before = self._candidate_snapshot(runtime.candidate(first_candidate))
        runtime.close()

        reopened = self._runtime()

        self.assertEqual(reopened.job(first["id"]), first)
        self.assertEqual(reopened.job(second["id"]), second)
        self.assertEqual(
            self._candidate_snapshot(reopened.candidate(first_candidate)),
            candidate_before,
        )
        self.assertEqual(reopened.promotion(), rollback)
        response = reopened.evaluate(self._request())
        self.assertEqual(response["candidateId"], first_candidate)
        self.assertEqual(response["promotionGeneration"], 3)

    def test_restart_recovers_a_promotion_generation_written_before_the_pointer(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        first_promotion = runtime.promote(
            first["candidateId"],
            promoted_by="first-operator",
            expected_generation=0,
            idempotency_key="restart-promote-first",
        )
        second_promotion = runtime.promote(
            second["candidateId"],
            promoted_by="second-operator",
            expected_generation=1,
            idempotency_key="restart-promote-second",
        )
        runtime.close()
        (self.state_dir / "promotion.json").write_text(
            json.dumps(first_promotion),
            encoding="utf-8",
        )

        reopened = self._runtime()

        self.assertEqual(reopened.promotion(), second_promotion)

    def test_retry_reconciles_a_generation_written_before_the_pointer(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        candidates = runtime.local_connectors.candidates
        original = candidates._write_promotion_record

        def fail_pointer(saved, owner_kind):
            with mock.patch(
                "replica_brand_check.local_connectors._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(saved, owner_kind)

        with mock.patch.object(
            candidates,
            "_write_promotion_record",
            side_effect=fail_pointer,
        ):
            with self.assertRaises(OSError):
                runtime.promote(
                    finished["candidateId"],
                    promoted_by="test-operator",
                    expected_generation=0,
                    idempotency_key="recover-promote",
                )

        recovered = runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="recover-promote",
        )
        self.assertEqual(recovered["generation"], 1)
        self.assertEqual(recovered["candidateId"], finished["candidateId"])

    def test_rollback_retry_returns_the_recovered_generation(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="rollback-retry-first",
        )
        runtime.promote(
            second["candidateId"],
            promoted_by="test-operator",
            expected_generation=1,
            idempotency_key="rollback-retry-second",
        )
        candidates = runtime.local_connectors.candidates
        original = candidates._write_promotion_record

        def fail_pointer(saved, owner_kind):
            with mock.patch(
                "replica_brand_check.local_connectors._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(saved, owner_kind)

        with mock.patch.object(
            candidates,
            "_write_promotion_record",
            side_effect=fail_pointer,
        ):
            with self.assertRaises(OSError):
                runtime.rollback(
                    rolled_back_by="test-operator",
                    expected_generation=2,
                    idempotency_key="recover-rollback",
                )

        recovered = runtime.rollback(
            rolled_back_by="test-operator",
            expected_generation=2,
            idempotency_key="recover-rollback",
        )
        self.assertEqual(recovered["generation"], 3)
        self.assertEqual(recovered["candidateId"], first["candidateId"])
        self.assertEqual(recovered["operation"], "rollback")

    def test_rollback_retry_returns_its_original_generation_after_a_later_promotion(self):
        runtime = self._runtime()
        jobs = [
            self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture",
                    max_updates=updates,
                    max_seconds=5,
                    max_credits=updates,
                )["id"],
            )
            for updates in (2, 4, 8)
        ]
        runtime.promote(
            jobs[0]["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="late-rollback-first",
        )
        runtime.promote(
            jobs[1]["candidateId"],
            promoted_by="test-operator",
            expected_generation=1,
            idempotency_key="late-rollback-second",
        )
        rollback = runtime.rollback(
            rolled_back_by="test-operator",
            expected_generation=2,
            idempotency_key="late-rollback",
        )
        later = runtime.promote(
            jobs[2]["candidateId"],
            promoted_by="test-operator",
            expected_generation=3,
            idempotency_key="late-rollback-third",
        )

        repeated = runtime.rollback(
            rolled_back_by="test-operator",
            expected_generation=2,
            idempotency_key="late-rollback",
        )

        self.assertEqual(repeated, rollback)
        self.assertEqual(runtime.promotion(), later)

    def test_rollback_continues_after_recovering_an_interrupted_promotion(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="first-operator",
            expected_generation=0,
            idempotency_key="continue-first",
        )
        candidates = runtime.local_connectors.candidates
        original = candidates._write_promotion_record

        def fail_pointer(saved, owner_kind):
            with mock.patch(
                "replica_brand_check.local_connectors._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(saved, owner_kind)

        with mock.patch.object(
            candidates,
            "_write_promotion_record",
            side_effect=fail_pointer,
        ):
            with self.assertRaises(OSError):
                runtime.promote(
                    second["candidateId"],
                    promoted_by="second-operator",
                    expected_generation=1,
                    idempotency_key="continue-second",
                )

        rollback = runtime.rollback(
            rolled_back_by="rollback-operator",
            expected_generation=2,
            idempotency_key="continue-rollback",
        )

        self.assertEqual(rollback["generation"], 3)
        self.assertEqual(rollback["candidateId"], first["candidateId"])
        self.assertEqual(rollback["previousCandidateId"], second["candidateId"])
        self.assertEqual(rollback["operation"], "rollback")

    def test_promotion_read_does_not_consume_a_pending_rollback_recovery(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="read-recovery-first",
        )
        runtime.promote(
            second["candidateId"],
            promoted_by="test-operator",
            expected_generation=1,
            idempotency_key="read-recovery-second",
        )
        candidates = runtime.local_connectors.candidates
        original = candidates._write_promotion_record

        def fail_pointer(saved, owner_kind):
            with mock.patch(
                "replica_brand_check.local_connectors._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(saved, owner_kind)

        with mock.patch.object(
            candidates,
            "_write_promotion_record",
            side_effect=fail_pointer,
        ):
            with self.assertRaises(OSError):
                runtime.rollback(
                    rolled_back_by="test-operator",
                    expected_generation=2,
                    idempotency_key="read-recovery-rollback",
                )

        self.assertEqual(runtime.promotion()["generation"], 2)
        recovered = runtime.rollback(
            rolled_back_by="test-operator",
            expected_generation=2,
            idempotency_key="read-recovery-rollback",
        )

        self.assertEqual(recovered["generation"], 3)
        self.assertEqual(recovered["candidateId"], first["candidateId"])

    def test_production_rejects_fixture_promotion_without_changing_the_current_generation(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=2, max_seconds=5, max_credits=2
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="production-first",
        )
        before = runtime.promotion()
        runtime.close()

        production = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="production",
        )
        self.addCleanup(production.close)

        with self.assertRaises(RuntimeFailure) as refused:
            production.promote(
                second["candidateId"],
                promoted_by="production-operator",
                expected_generation=1,
                idempotency_key="production-second",
            )

        self.assertEqual(refused.exception.code, "candidate_not_production_eligible")
        self.assertEqual(refused.exception.status, 409)
        self.assertEqual(production.promotion(), before)
        with self.assertRaises(RuntimeFailure) as not_ready:
            production.ready()
        self.assertEqual(not_ready.exception.code, "candidate_not_production_eligible")
        with self.assertRaises(RuntimeFailure) as not_served:
            production.evaluate(self._request())
        self.assertEqual(not_served.exception.code, "candidate_not_production_eligible")

    def test_restart_revalidates_a_pending_promotion_before_recovery(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture",
                max_updates=2,
                max_seconds=5,
                max_credits=2,
            )["id"],
        )
        with mock.patch.object(
            runtime.local_connectors.candidates,
            "_write_promotion_record",
            side_effect=OSError("history unavailable"),
        ):
            with self.assertRaises(OSError):
                runtime.promote(
                    finished["candidateId"],
                    promoted_by="test-operator",
                    expected_generation=0,
                    idempotency_key="pending-production-promotion",
                )
        runtime.close()

        with self.assertRaises(RuntimeFailure) as ineligible:
            LocalRuntime(
                self.state_dir,
                self.taskset_dir,
                environment="production",
            )

        self.assertEqual(ineligible.exception.code, "candidate_not_production_eligible")
        self.assertFalse((self.state_dir / "promotion.json").exists())
        self.assertEqual(list((self.state_dir / "promotions").glob("*.json")), [])

    def test_production_rejects_rollback_to_a_fixture_candidate(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=2, max_seconds=5, max_credits=2
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="first-operator",
            expected_generation=0,
            idempotency_key="production-rollback-first",
        )
        runtime.promote(
            second["candidateId"],
            promoted_by="second-operator",
            expected_generation=1,
            idempotency_key="production-rollback-second",
        )
        before = runtime.promotion()
        runtime.close()

        production = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="production",
        )
        self.addCleanup(production.close)

        with self.assertRaises(RuntimeFailure) as refused:
            production.rollback(
                rolled_back_by="production-operator",
                expected_generation=2,
                idempotency_key="production-rollback",
            )

        self.assertEqual(refused.exception.code, "candidate_not_production_eligible")
        self.assertEqual(refused.exception.status, 409)
        self.assertEqual(production.promotion(), before)

    def test_reopened_runtime_refuses_a_promoted_candidate_from_another_taskset(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            first["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="mismatch-first",
        )
        runtime.promote(
            second["candidateId"],
            promoted_by="test-operator",
            expected_generation=1,
            idempotency_key="mismatch-second",
        )
        runtime.close()
        tasks_path = self.taskset_dir / "tasks.jsonl"
        tasks = [json.loads(line) for line in tasks_path.read_text(encoding="utf-8").splitlines()]
        tasks[0]["questions"][RULE]["instructions"] = "A different taskset"
        tasks_path.write_text(
            "".join(json.dumps(task) + "\n" for task in tasks),
            encoding="utf-8",
        )
        reopened = self._runtime()

        with self.assertRaises(RuntimeFailure) as not_ready:
            reopened.ready()
        with self.assertRaises(RuntimeFailure) as not_served:
            reopened.evaluate(self._request())
        with self.assertRaises(RuntimeFailure) as not_rolled_back:
            reopened.rollback(
                rolled_back_by="test-operator",
                expected_generation=2,
                idempotency_key="mismatch-rollback",
            )

        self.assertEqual(not_ready.exception.code, "candidate_mismatch")
        self.assertEqual(not_served.exception.code, "candidate_mismatch")
        self.assertEqual(not_rolled_back.exception.code, "candidate_mismatch")

    def test_candidate_taskset_connector_failures_keep_service_status(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="promote-taskset-failure",
        )
        runtime.close()
        reopened = self._runtime()

        for category, code, status in (
            ("unavailable", "tasksets_unavailable", 503),
            ("deadline_exceeded", "tasksets_deadline", 504),
        ):
            with self.subTest(category=category), mock.patch.object(
                reopened.connectors.tasksets,
                "resolve",
                side_effect=ConnectorError(
                    code,
                    "provider detail",
                    category=category,
                ),
            ):
                with self.assertRaises(RuntimeFailure) as failure:
                    reopened.ready()

                self.assertEqual(failure.exception.code, code)
                self.assertEqual(failure.exception.status, status)
                self.assertEqual(str(failure.exception), "Connector operation failed.")

    def test_ready_and_evaluate_use_the_loaded_taskset_identity(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=4, max_seconds=5, max_credits=4
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="loaded-taskset-promotion",
        )
        image_path = self.taskset_dir / "images" / "screen.png"
        image_path.write_bytes(b"changed after activation")

        runtime.ready()
        response = runtime.evaluate(self._request())

        self.assertEqual(response["candidateId"], finished["candidateId"])

    def test_bounds_parsed_tasksets_without_rehashing_the_promoted_taskset(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture",
                max_updates=4,
                max_seconds=5,
                max_credits=4,
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="bounded-taskset-promotion",
        )
        uploaded_digests = []
        for index in range(TASKSET_CACHE_LIMIT + 1):
            task = make_task(100 + index, answer=True)
            task["questions"][RULE]["instructions"] = f"Uploaded taskset {index}"
            directory = write_taskset(
                self,
                [task, make_task(200 + index, split="test", answer=True)],
            )
            digest, upload = taskset_upload(directory)
            registered = runtime.register_taskset(
                digest,
                upload,
                idempotency_key=f"upload-{index}",
            )
            uploaded_digests.append(registered["digest"])

        (self.taskset_dir / "images" / "screen.png").write_bytes(
            b"changed after activation"
        )
        runtime.ready()
        response = runtime.evaluate(self._request())

        self.assertLessEqual(len(runtime._tasksets), TASKSET_CACHE_LIMIT)
        self.assertNotIn(uploaded_digests[0], runtime._tasksets)
        self.assertIn(uploaded_digests[-1], runtime._tasksets)
        self.assertEqual(response["candidateId"], finished["candidateId"])

    def test_http_upload_registers_a_private_taskset_for_jobs_and_restart(self):
        uploaded_directory = write_taskset(
            self,
            [
                make_task(21, answer=True),
                make_task(22, split="test", answer=True),
            ],
        )
        digest, upload = taskset_upload(uploaded_directory)
        runtime = self._runtime()
        server, thread, base_url = self._serve(runtime)
        encoded = json.dumps(upload).encode()
        url = f"{base_url}/v1/tasksets/{digest}"

        with self.assertRaises(error.HTTPError) as refused:
            request.urlopen(
                request.Request(
                    url,
                    data=encoded,
                    headers={"Content-Type": "application/json"},
                    method="PUT",
                )
            )
        self.assertEqual(refused.exception.code, 401)
        refused.exception.close()

        headers = {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        }
        with mock.patch.object(
            runtime.connectors.tasksets,
            "register",
            wraps=runtime.connectors.tasksets.register,
        ) as register:
            first_status, first = self._http_json_response(
                request.Request(url, data=encoded, headers=headers, method="PUT")
            )
        register.assert_called_once()
        retry_status, retried = self._http_json_response(
            request.Request(url, data=encoded, headers=headers, method="PUT")
        )

        self.assertIn(first_status, (200, 201))
        self.assertIn(retry_status, (200, 201))
        self.assertEqual(retried, first)
        self.assertEqual(first["digest"], f"sha256:{digest}")
        self.assertEqual(first["reference"], f"taskset:{digest}")
        self.assertIn(
            "taskset_bytes",
            [usage.kind for usage in runtime.local_connectors.observability.records()],
        )

        changed = json.loads(json.dumps(upload))
        changed["tasks"][0]["questions"][RULE]["instructions"] = "Different content"
        with self.assertRaises(error.HTTPError) as conflict:
            request.urlopen(
                request.Request(
                    url,
                    data=json.dumps(changed).encode(),
                    headers={**headers, "Idempotency-Key": "changed-upload"},
                    method="PUT",
                )
            )
        self.assertEqual(conflict.exception.code, 409)
        with conflict.exception as response:
            self.assertNotIn("Different content", response.read().decode())

        server.shutdown()
        server.server_close()
        thread.join(1)
        runtime.close()
        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="test",
        )
        self.addCleanup(reopened.close)
        _server, _thread, reopened_url = self._serve(reopened)
        submitted = self._http_json(
            request.Request(
                f"{reopened_url}/v1/jobs",
                data=json.dumps(
                    {
                        "backend": "fixture",
                        "maxUpdates": 2,
                        "maxSeconds": 5,
                        "maxCredits": 2,
                        "tasksetDigest": first["digest"],
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        finished = self._wait_for_http_job(reopened_url, submitted["id"])

        self.assertEqual(finished["state"], "succeeded")
        self.assertEqual(finished["tasksetDigest"], first["digest"])
        promotion = reopened.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="uploaded-taskset-promotion",
        )
        self.assertEqual(promotion["candidateId"], finished["candidateId"])

        shutil.rmtree(self.state_dir / "tasksets" / digest)
        with self.assertRaises(RuntimeFailure) as missing_taskset:
            reopened.promote(
                finished["candidateId"],
                promoted_by="test-operator",
                expected_generation=1,
                idempotency_key="missing-uploaded-taskset",
            )
        self.assertEqual(missing_taskset.exception.code, "candidate_mismatch")

    def test_http_taskset_upload_rejects_invalid_bundles_with_stable_safe_errors(self):
        uploaded_directory = write_taskset(
            self,
            [
                make_task(31, answer=True),
                make_task(32, split="test", answer=True),
            ],
        )
        digest, valid = taskset_upload(uploaded_directory)
        runtime = self._runtime()
        _server, _thread, base_url = self._serve(runtime)
        headers = {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        }

        cases = {}
        wrong_digest = json.loads(json.dumps(valid))
        cases["claimed digest"] = ("0" * 64, wrong_digest, None)
        traversal = json.loads(json.dumps(valid))
        traversal["tasks"][0]["images"][0]["path"] = "../screen.png"
        traversal["images"][0]["path"] = "../screen.png"
        cases["path containment"] = (digest, traversal, None)
        reserved = json.loads(json.dumps(valid))
        reserved["tasks"][0]["images"][0]["path"] = "taskset.json"
        reserved["images"][0]["path"] = "taskset.json"
        cases["reserved taskset path"] = (digest, reserved, None)
        nul_path = json.loads(json.dumps(valid))
        nul_path["tasks"][0]["images"][0]["path"] = "images/\x00screen.png"
        nul_path["images"][0]["path"] = "images/\x00screen.png"
        cases["NUL path"] = (digest, nul_path, None)
        normalized_collision = json.loads(json.dumps(valid))
        normalized_collision["images"].append(
            {
                **normalized_collision["images"][0],
                "path": "images/./screen.png",
            }
        )
        cases["normalized path collision"] = (digest, normalized_collision, None)
        file_directory_collision = json.loads(json.dumps(valid))
        file_directory_collision["images"].append(
            {
                **file_directory_collision["images"][0],
                "path": "images/screen.png/detail.png",
            }
        )
        cases["file and directory collision"] = (
            digest,
            file_directory_collision,
            None,
        )
        invalid_path_type = json.loads(json.dumps(valid))
        invalid_path_type["images"][0]["path"] = 7
        cases["non-string image path"] = (digest, invalid_path_type, "invalid_input")
        invalid_media_type = json.loads(json.dumps(valid))
        invalid_media_type["images"][0]["mediaType"] = 7
        cases["non-string image media type"] = (
            digest,
            invalid_media_type,
            "invalid_input",
        )
        image_mismatch = json.loads(json.dumps(valid))
        image_mismatch["images"][0]["dataBase64"] = base64.b64encode(b"changed").decode()
        cases["image digest"] = (digest, image_mismatch, None)
        media_type_mismatch = json.loads(json.dumps(valid))
        media_type_mismatch["images"][0]["mediaType"] = "image/jpeg"
        cases["image media type"] = (digest, media_type_mismatch, None)
        extra_image = json.loads(json.dumps(valid))
        extra_image["images"].append(
            {
                **extra_image["images"][0],
                "path": "images/extra.png",
            }
        )
        cases["extra image"] = (digest, extra_image, None)
        too_many = json.loads(json.dumps(valid))
        too_many["tasks"][0]["images"] = [
            dict(too_many["tasks"][0]["images"][0]) for _ in range(6)
        ]
        cases["image count"] = (digest, too_many, None)
        oversized = json.loads(json.dumps(valid))
        oversized["images"][0]["dataBase64"] = base64.b64encode(
            b"x" * (MAX_IMAGE_BYTES + 1)
        ).decode()
        cases["image size"] = (digest, oversized, None)
        invalid_manifest = json.loads(json.dumps(valid))
        invalid_manifest["manifest"]["schemaVersion"] = "unsupported"
        cases["manifest contract"] = (digest, invalid_manifest, None)

        for name, (claimed_digest, body, expected_code) in cases.items():
            with self.subTest(name=name):
                http_request = request.Request(
                    f"{base_url}/v1/tasksets/{claimed_digest}",
                    data=json.dumps(body).encode(),
                    headers=headers,
                    method="PUT",
                )
                first = self._http_error(http_request)
                repeated = self._http_error(http_request)

                self.assertEqual(first[0], 400)
                self.assertEqual(repeated, first)
                self.assertEqual(set(first[1]["error"]), {"code", "message"})
                self.assertTrue(first[1]["error"]["code"])
                if expected_code is not None:
                    self.assertEqual(first[1]["error"]["code"], expected_code)
                self.assertNotIn("dataBase64", first[1]["error"]["message"])
                self.assertNotIn(str(self.state_dir), first[1]["error"]["message"])

    def test_http_promotion_requires_generation_and_keeps_stale_retries_atomic(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=2, max_seconds=5, max_credits=2
            )["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        _server, _thread, base_url = self._serve(runtime)
        url = f"{base_url}/v1/promotions"
        headers = {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "Idempotency-Key": "promote-http-cas",
        }

        missing_generation = self._http_error(
            request.Request(
                url,
                data=json.dumps(
                    {
                        "candidateId": first["candidateId"],
                        "promotedBy": "operator",
                    }
                ).encode(),
                headers=headers,
            )
        )
        self.assertEqual(missing_generation[0], 400)
        self.assertEqual(missing_generation[1]["error"]["code"], "invalid_input")
        self.assertIsNone(runtime.promotion(required=False))

        body = json.dumps(
            {
                "candidateId": first["candidateId"],
                "promotedBy": "operator",
                "expectedGeneration": 0,
            }
        ).encode()
        first_promotion = self._http_json(
            request.Request(url, data=body, headers=headers)
        )
        exact_retry = self._http_json(
            request.Request(url, data=body, headers=headers)
        )
        history_before = self._tree_snapshot(self.state_dir / "promotions")
        pointer_before = (self.state_dir / "promotion.json").read_bytes()

        stale = self._http_error(
            request.Request(
                url,
                data=json.dumps(
                    {
                        "candidateId": "candidate_missing",
                        "promotedBy": "operator",
                        "expectedGeneration": 0,
                    }
                ).encode(),
                headers={**headers, "Idempotency-Key": "stale-http-cas"},
            )
        )
        changed_retry = self._http_error(
            request.Request(
                url,
                data=json.dumps(
                    {
                        "candidateId": second["candidateId"],
                        "promotedBy": "operator",
                        "expectedGeneration": 0,
                    }
                ).encode(),
                headers=headers,
            )
        )

        self.assertEqual(exact_retry, first_promotion)
        self.assertEqual(stale[0], 409)
        self.assertEqual(stale[1]["error"]["code"], "promotion_generation_conflict")
        self.assertEqual(changed_retry[0], 409)
        self.assertEqual(changed_retry[1]["error"]["code"], "idempotency_conflict")
        self.assertEqual(self._tree_snapshot(self.state_dir / "promotions"), history_before)
        self.assertEqual((self.state_dir / "promotion.json").read_bytes(), pointer_before)

        second_promotion = self._http_json(
            request.Request(
                url,
                data=json.dumps(
                    {
                        "candidateId": second["candidateId"],
                        "promotedBy": "operator",
                        "expectedGeneration": 1,
                    }
                ).encode(),
                headers={**headers, "Idempotency-Key": "promote-http-second"},
            )
        )
        late_exact_retry = self._http_json(
            request.Request(url, data=body, headers=headers)
        )
        rollback_url = f"{base_url}/v1/rollbacks"
        missing_rollback_generation = self._http_error(
            request.Request(
                rollback_url,
                data=json.dumps({"rolledBackBy": "operator"}).encode(),
                headers={**headers, "Idempotency-Key": "rollback-http-missing"},
            )
        )
        stale_rollback = self._http_error(
            request.Request(
                rollback_url,
                data=json.dumps(
                    {
                        "rolledBackBy": "operator",
                        "expectedGeneration": 1,
                    }
                ).encode(),
                headers={**headers, "Idempotency-Key": "rollback-http-stale"},
            )
        )
        self.assertEqual(second_promotion["generation"], 2)
        self.assertEqual(late_exact_retry, first_promotion)
        self.assertEqual(missing_rollback_generation[0], 400)
        self.assertEqual(
            missing_rollback_generation[1]["error"]["code"],
            "invalid_input",
        )
        self.assertEqual(stale_rollback[0], 409)
        self.assertEqual(
            stale_rollback[1]["error"]["code"],
            "promotion_generation_conflict",
        )
        self.assertEqual(runtime.promotion(), second_promotion)

    def test_budget_violation_wins_a_concurrent_public_cancellation(self):
        validation_started = threading.Event()
        release_validation = threading.Event()
        cancellation_started = threading.Event()
        cancellation_result = {}
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"over-budget": OverBudgetBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)
        original = runtime_module._validated_training_usage

        def pause_validation(result, context, connector):
            validation_started.set()
            self.assertTrue(release_validation.wait(5))
            return original(result, context, connector)

        def cancel(job_id):
            cancellation_started.set()
            try:
                cancellation_result["job"] = runtime.cancel(
                    job_id,
                    idempotency_key="cancel-budget-race",
                )
            except RuntimeFailure as failure:
                cancellation_result["error"] = failure

        with mock.patch(
            "replica_brand_check.runtime._validated_training_usage",
            side_effect=pause_validation,
        ):
            submitted = runtime.submit(
                backend="over-budget",
                max_updates=1,
                max_seconds=5,
                max_credits=1,
            )
            self.assertTrue(validation_started.wait(5))
            cancellation = threading.Thread(target=cancel, args=(submitted["id"],))
            cancellation.start()
            self.assertTrue(cancellation_started.wait(5))
            release_validation.set()
            terminal = self._wait_for_job(runtime, submitted["id"])
            cancellation.join(5)

        self.assertEqual(terminal["state"], "failed")
        self.assertEqual(terminal["error"]["code"], "credit_budget_exceeded")
        self.assertNotIn("candidateId", terminal)
        self.assertEqual(terminal["usage"][0]["quantity"], 2)
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertIsNone(runtime.promotion(required=False))
        self.assertEqual(cancellation_result["error"].code, "job_terminal")

    def test_http_cancels_a_running_job_without_publishing_a_stale_candidate(self):
        started = self.taskset_dir / ".cancel-started"
        release = self.taskset_dir / ".cancel-release"
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"cancellable": CancellableBackend(started, release)},
            environment="test",
        )
        self.addCleanup(runtime.close)
        _server, _thread, base_url = self._serve(runtime)
        submitted = self._http_json(
            request.Request(
                f"{base_url}/v1/jobs",
                data=json.dumps(
                    {
                        "backend": "cancellable",
                        "maxUpdates": 2,
                        "maxSeconds": 30,
                        "maxCredits": 2,
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())

        cancel_request = request.Request(
            f"{base_url}/v1/jobs/{submitted['id']}/cancel",
            data=b"{}",
            headers={
                "Authorization": f"Bearer {TOKEN}",
                "Content-Type": "application/json",
                "Idempotency-Key": "cancel-running",
            },
        )
        before = time.monotonic()
        try:
            cancelled = self._http_json(cancel_request)
        except Exception:
            release.write_text("release", encoding="utf-8")
            raise

        self.assertLess(time.monotonic() - before, 2)
        self.assertEqual(cancelled["state"], "cancelled")
        self.assertNotIn("candidateId", cancelled)
        self.assertEqual(runtime.job(submitted["id"])["state"], "cancelled")
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertFalse(release.exists())
        self.assertNotIn("usage", runtime.job(submitted["id"]))
        self.assertIn(
            "job_cancellations",
            [
                record.kind
                for record in runtime.local_connectors.observability.records()
            ],
        )

        runtime.close()
        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"cancellable": CancellableBackend(started, release)},
            environment="test",
        )
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.job(submitted["id"])["state"], "cancelled")

    def test_running_worker_receives_cancellation_before_process_termination(self):
        started = self.taskset_dir / ".cooperative-cancel-started"
        cancelled = self.taskset_dir / ".cooperative-cancel-received"
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={
                "cooperative": CooperativeCancellationBackend(started, cancelled)
            },
            environment="test",
        )
        self.addCleanup(runtime.close)
        submitted = runtime.submit(
            backend="cooperative",
            max_updates=1,
            max_seconds=30,
            max_credits=1,
        )
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists(), runtime.job(submitted["id"]))

        terminal = runtime.cancel(
            submitted["id"],
            idempotency_key="cancel-cooperative-worker",
        )
        deadline = time.monotonic() + 5
        while not cancelled.exists() and time.monotonic() < deadline:
            time.sleep(0.01)

        self.assertEqual(terminal["state"], "cancelled")
        self.assertTrue(cancelled.exists())

    def test_deadline_cleanup_remains_a_timeout_after_worker_cancellation(self):
        started = self.taskset_dir / ".deadline-cancel-started"
        cancelled = self.taskset_dir / ".deadline-cancel-received"
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={
                "cooperative": CooperativeCancellationBackend(started, cancelled)
            },
            environment="test",
        )
        self.addCleanup(runtime.close)
        submitted = runtime.submit(
            backend="cooperative",
            max_updates=1,
            max_seconds=1,
            max_credits=1,
        )

        terminal = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(terminal["state"], "failed")
        self.assertEqual(terminal["error"]["code"], "job_timed_out")
        self.assertTrue(cancelled.exists())

    def test_http_cancellation_is_safe_for_queued_retries_and_terminal_jobs(self):
        started = self.taskset_dir / ".queued-cancel-started"
        release = self.taskset_dir / ".queued-cancel-release"
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={
                "blocking": BlockingBackend(started, release),
                "fixture": FixtureBackend(),
                "failing": FailingBackend(),
            },
            environment="test",
        )
        self.addCleanup(runtime.close)
        _server, _thread, base_url = self._serve(runtime)
        running = runtime.submit(
            backend="blocking", max_updates=1, max_seconds=10, max_credits=1
        )
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())
        queued = runtime.submit(
            backend="fixture", max_updates=1, max_seconds=5, max_credits=1
        )

        with self.assertRaises(error.HTTPError) as unauthorized:
            request.urlopen(
                request.Request(
                    f"{base_url}/v1/jobs/{queued['id']}/cancel",
                    data=b"{}",
                    headers={"Content-Type": "application/json"},
                )
            )
        self.assertEqual(unauthorized.exception.code, 401)
        unauthorized.exception.close()

        def cancel(job_id, key):
            return self._http_json(
                request.Request(
                    f"{base_url}/v1/jobs/{job_id}/cancel",
                    data=b"{}",
                    headers={
                        "Authorization": f"Bearer {TOKEN}",
                        "Content-Type": "application/json",
                        "Idempotency-Key": key,
                    },
                )
            )

        first = cancel(queued["id"], "cancel-queued")
        same_retry = cancel(queued["id"], "cancel-queued")
        other_retry = cancel(queued["id"], "cancel-queued-again")
        self.assertEqual(first["state"], "cancelled")
        self.assertEqual(same_retry, first)
        self.assertEqual(other_retry, first)

        release.write_text("release", encoding="utf-8")
        self.assertEqual(self._wait_for_job(runtime, running["id"])["state"], "succeeded")
        failed = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="failing", max_updates=1, max_seconds=5, max_credits=1
            )["id"],
        )
        for job_id in (running["id"], failed["id"]):
            with self.subTest(job_id=job_id):
                terminal = self._http_error(
                    request.Request(
                        f"{base_url}/v1/jobs/{job_id}/cancel",
                        data=b"{}",
                        headers={
                            "Authorization": f"Bearer {TOKEN}",
                            "Content-Type": "application/json",
                        },
                    )
                )
                self.assertEqual(terminal[0], 409)
                self.assertEqual(terminal[1]["error"]["code"], "job_terminal")
                self.assertNotIn("backend-token", json.dumps(terminal[1]))

    def test_http_routes_require_the_token_and_track_an_authorized_job(self):
        runtime = self._runtime()
        server = RuntimeHTTPServer(("127.0.0.1", 0), runtime, TOKEN)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        body = json.dumps(
            {
                "backend": "fixture",
                "maxUpdates": 2,
                "maxSeconds": 5,
                "maxCredits": 2,
            }
        ).encode()

        with self.assertRaises(error.HTTPError) as refused:
            request.urlopen(
                request.Request(
                    f"{base_url}/v1/jobs",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
            )
        self.assertEqual(refused.exception.code, 401)
        with self.assertRaises(error.HTTPError) as not_ready:
            request.urlopen(f"{base_url}/ready")
        self.assertEqual(not_ready.exception.code, 503)

        submitted = self._http_json(
            request.Request(
                f"{base_url}/v1/jobs",
                data=body,
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        finished = self._wait_for_http_job(base_url, submitted["id"])
        self.assertEqual(finished["state"], "succeeded")
        self._http_json(
            request.Request(
                f"{base_url}/v1/promotions",
                data=json.dumps(
                    {
                        "candidateId": finished["candidateId"],
                        "promotedBy": "test-operator",
                        "expectedGeneration": 0,
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "http-promote-first",
                },
            )
        )
        second = self._http_json(
            request.Request(
                f"{base_url}/v1/jobs",
                data=json.dumps(
                    {
                        "backend": "fixture",
                        "maxUpdates": 8,
                        "maxSeconds": 5,
                        "maxCredits": 8,
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        second = self._wait_for_http_job(base_url, second["id"])
        self._http_json(
            request.Request(
                f"{base_url}/v1/promotions",
                data=json.dumps(
                    {
                        "candidateId": second["candidateId"],
                        "promotedBy": "test-operator",
                        "expectedGeneration": 1,
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "http-promote-second",
                },
            )
        )
        rollback = self._http_json(
            request.Request(
                f"{base_url}/v1/rollbacks",
                data=json.dumps(
                    {
                        "rolledBackBy": "test-operator",
                        "expectedGeneration": 2,
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "http-rollback",
                },
            )
        )
        scored = self._http_json(
            request.Request(
                f"{base_url}/score",
                data=json.dumps(self._request()).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        self.assertEqual(rollback["generation"], 3)
        self.assertEqual(rollback["candidateId"], finished["candidateId"])
        self.assertEqual(rollback["previousCandidateId"], second["candidateId"])
        self.assertEqual(scored["candidateId"], finished["candidateId"])
        self.assertEqual(scored["promotionGeneration"], 3)
        self.assertEqual(self._http_json(f"{base_url}/ready"), {"status": "ready"})

    def test_http_ready_returns_safe_runtime_capability_detail(self):
        runtime = mock.Mock(spec=LocalRuntime)
        readiness = {
            "status": "ready",
            "backend": {
                "backend": "d1-omni",
                "accelerator": "cuda",
                "inference": True,
                "training": True,
                "status": "ready",
                "modelDirectory": {
                    "available": True,
                    "trusted": True,
                    "revisionVerified": True,
                    "artifactsVerified": True,
                },
            },
        }
        runtime.ready.return_value = readiness
        _server, _thread, base_url = self._serve(runtime)

        response = self._http_json(f"{base_url}/ready")

        self.assertEqual(response, readiness)
        self.assertNotIn("path", response["backend"]["modelDirectory"])
        self.assertNotIn("candidateId", response)
        self.assertNotIn("tasksetDigest", response)

    def test_runtime_main_starts_d1_without_a_mounted_taskset(self):
        runtime = mock.Mock()
        server = mock.Mock()
        argv = [
            "replica-decision-runtime",
            "--state",
            str(self.state_dir),
            "--d1-model",
            "reviewed-model",
        ]

        with mock.patch.object(sys, "argv", argv), mock.patch.dict(
            os.environ,
            {runtime_server_module.TOKEN_VARIABLE: TOKEN},
        ), mock.patch.object(
            runtime_server_module,
            "D1OmniBackend",
        ) as d1_backend, mock.patch.object(
            runtime_server_module,
            "LocalRuntime",
            return_value=runtime,
        ) as local_runtime, mock.patch.object(
            runtime_server_module,
            "RuntimeHTTPServer",
            return_value=server,
        ), mock.patch.object(
            runtime_server_module.signal,
            "getsignal",
            return_value=signal.SIG_DFL,
        ), mock.patch.object(
            runtime_server_module.signal,
            "signal",
        ):
            runtime_server_module.main()

        d1_backend.assert_called_once_with(Path("reviewed-model"))
        runtime_args = local_runtime.call_args.args
        self.assertIsNone(runtime_args[1])
        self.assertIs(runtime_args[2]["d1-omni"], d1_backend.return_value)
        server.serve_forever.assert_called_once_with()
        runtime.close.assert_called_once_with()

    def test_header_deadline_releases_a_connection_slot(self):
        runtime = self._runtime()
        with mock.patch("replica_brand_check.runtime_server.MAX_CONNECTIONS", 1):
            server = RuntimeHTTPServer(("127.0.0.1", 0), runtime, TOKEN)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        with mock.patch(
            "replica_brand_check.runtime_server.SOCKET_TIMEOUT_SECONDS", 0.05
        ):
            connection = socket.create_connection(server.server_address)
            self.addCleanup(connection.close)
            connection.sendall(b"GET /health HTTP/1.0\r\nX-Slow: ")
            time.sleep(0.1)

        connection.settimeout(1)
        self.assertEqual(connection.recv(1), b"")
        deadline = time.monotonic() + 1
        while True:
            try:
                health = self._http_json(
                    f"http://127.0.0.1:{server.server_address[1]}/health"
                )
                break
            except (error.URLError, ConnectionError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)
        self.assertEqual(health, {"status": "healthy"})

    def test_unknown_calibration_is_not_reported_as_not_worse(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"unknown": UnknownCalibrationBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="unknown", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        report = runtime.candidate(finished["candidateId"])["evaluation"]
        self.assertIsNone(report["evidence"]["calibrationErrorDelta"])
        self.assertIsNone(report["evidence"]["calibrationNotWorse"])

    def test_acknowledged_state_syncs_files_and_directories(self):
        synced = []
        real_fsync = os.fsync

        def record_fsync(descriptor):
            synced.append(os.fstat(descriptor).st_mode)
            return real_fsync(descriptor)

        with mock.patch("replica_brand_check.runtime.os.fsync", side_effect=record_fsync):
            runtime = self._runtime()
            finished = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture", max_updates=8, max_seconds=5, max_credits=8
                )["id"],
            )
            runtime.promote(
                finished["candidateId"],
                promoted_by="test-operator",
                expected_generation=0,
                idempotency_key="fsync-promotion",
            )

        self.assertTrue(any(stat.S_ISREG(mode) for mode in synced))
        self.assertTrue(any(stat.S_ISDIR(mode) for mode in synced))

    def test_refuses_malformed_questions_before_calling_the_backend(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="test-operator",
            expected_generation=0,
            idempotency_key="malformed-question-promotion",
        )
        malformed = self._request()
        malformed["questions"]["severity"] = {
            "type": "score",
            "instructions": "How severe is it?",
            "criteria": "x" * 10_000,
        }

        with self.assertRaises(RuntimeFailure) as invalid:
            runtime.evaluate(malformed)

        self.assertEqual(invalid.exception.code, "invalid_input")

    def test_immutable_write_failure_does_not_publish_a_partial_generation(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture", max_updates=8, max_seconds=5, max_credits=8
            )["id"],
        )
        with mock.patch("replica_brand_check.runtime.os.link", side_effect=OSError("stopped")):
            with self.assertRaises(OSError):
                runtime.promote(
                    finished["candidateId"],
                    promoted_by="test-operator",
                    expected_generation=0,
                    idempotency_key="failed-immutable-promotion",
                )

        self.assertEqual(list((self.state_dir / "promotions").iterdir()), [])
        self.assertIsNone(runtime.promotion(required=False))

    def _runtime(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="test",
        )
        self.addCleanup(runtime.close)
        return runtime

    def _serve(self, runtime):
        server = RuntimeHTTPServer(("127.0.0.1", 0), runtime, TOKEN)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, thread, f"http://127.0.0.1:{server.server_address[1]}"

    def _request(self):
        task = make_task(99, split="test", answer=True)
        return {
            "state": task["state"],
            "images": [
                "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
            ],
            "questions": task["questions"],
        }

    def _wait_for_job(self, runtime, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = runtime.job(job_id)
            if job["state"] in {"succeeded", "failed"}:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not finish")

    def _wait_for_usage_error(self, runtime, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = runtime.job(job_id)
            if "usageError" in job:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not persist its usage error")

    def _wait_for_http_job(self, base_url, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = self._http_json(
                request.Request(
                    f"{base_url}/v1/jobs/{job_id}",
                    headers={"Authorization": f"Bearer {TOKEN}"},
                )
            )
            if job["state"] in {"succeeded", "failed"}:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not finish")

    def _http_json(self, http_request):
        with request.urlopen(http_request) as response:
            return json.load(response)

    def _http_json_response(self, http_request):
        with request.urlopen(http_request) as response:
            return response.status, json.load(response)

    def _http_error(self, http_request):
        with self.assertRaises(error.HTTPError) as failed:
            request.urlopen(http_request)
        with failed.exception as response:
            return response.code, json.load(response)

    def _candidate_documents(self, candidate):
        self.assertIsInstance(candidate, Mapping)
        manifest = self._document(candidate, "manifest")
        report = self._document(candidate, "evaluation")
        self.assertIsInstance(manifest, Mapping)
        self.assertIsInstance(report, Mapping)
        return manifest, report

    def _document(self, candidate, name):
        for key in (name, f"{name}Path", f"{name}_path"):
            if key not in candidate:
                continue
            value = candidate[key]
            if isinstance(value, Mapping):
                return value
            return json.loads(Path(value).read_text(encoding="utf-8"))
        self.fail(f"candidate does not expose its {name}")

    def _candidate_snapshot(self, candidate):
        manifest, report = self._candidate_documents(candidate)
        return json.dumps(
            {"manifest": manifest, "report": report},
            sort_keys=True,
            separators=(",", ":"),
        )

    def _tree_snapshot(self, root):
        if not root.exists():
            return ()
        return tuple(
            (path.relative_to(root).as_posix(), path.read_bytes())
            for path in sorted(root.rglob("*"))
            if path.is_file()
        )

    def _remove_state(self):
        if not self.state_dir.exists():
            return
        for path in sorted(self.state_dir.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            else:
                path.rmdir()
        self.state_dir.rmdir()


class RuntimeTokenTest(unittest.TestCase):
    def test_requires_a_strong_printable_token_without_revealing_it(self):
        for token in ("", "short", "x" * 31, "x" * 31 + " "):
            with self.subTest(token=token):
                with self.assertRaises(RuntimeFailure) as refused:
                    runtime_token({"REPLICA_RUNTIME_TOKEN": token})
                if token:
                    self.assertNotIn(token, str(refused.exception))

        token = "runtime-token-with-at-least-32-characters"
        self.assertEqual(runtime_token({"REPLICA_RUNTIME_TOKEN": token}), token)


if __name__ == "__main__":
    unittest.main()
