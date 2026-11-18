"""Customer-operated training and serving through the local runtime."""

from __future__ import annotations

import base64
import json
import multiprocessing
import shutil
import socket
import threading
import time
import unittest
from collections.abc import Mapping
from pathlib import Path
from unittest import mock
from urllib import error, request

from replica_brand_check.runtime import FixtureBackend, LocalRuntime, RuntimeFailure
from replica_brand_check.runtime_server import RuntimeHTTPServer, runtime_token
from tests.support import PNG, RULE, make_task, write_taskset

TOKEN = "runtime-test-token-with-32-characters"


class FailingBackend(FixtureBackend):
    """A backend that fails after the runtime has accepted its job."""

    def train(self, *args, **kwargs):
        raise RuntimeError("deliberate backend failure")


class SlowBackend(FixtureBackend):
    """A backend that ignores its deadline, to prove the runtime still bounds the job."""

    def train(self, *args, **kwargs):
        time.sleep(2)
        return super().train(*args, **kwargs)


class BlockingBackend(FixtureBackend):
    """A backend whose first job waits so a second job stays queued during close."""

    def __init__(self):
        context = multiprocessing.get_context("fork")
        self.started = context.Event()
        self.release = context.Event()

    def train(self, *args, **kwargs):
        self.started.set()
        self.release.wait(5)
        return super().train(*args, **kwargs)


class CapturingBackend(FixtureBackend):
    """A fixture backend that records the projected inference request."""

    def __init__(self):
        self.request = None

    def predict(self, adapter, request, *, timeout_seconds):
        self.request = request
        return super().predict(adapter, request, timeout_seconds=timeout_seconds)


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

        submitted = runtime.submit(backend="fixture", max_updates=8, max_seconds=5)
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

        promotion = runtime.promote(candidate_id, promoted_by="test-operator")
        self.assertEqual(promotion["candidateId"], candidate_id)
        response = runtime.evaluate(self._request())

        self.assertEqual(response["candidateId"], candidate_id)
        self.assertIn("schemaVersion", response)
        self.assertIn(RULE, response["answers"])
        self.assertEqual(response["evaluations"][0]["learningId"], RULE)
        self.assertEqual(self._candidate_snapshot(runtime.candidate(candidate_id)), before)

        before_rollback = runtime.promotion()
        with self.assertRaises(RuntimeFailure) as unavailable:
            runtime.rollback(rolled_back_by="test-operator")
        self.assertEqual(unavailable.exception.code, "rollback_unavailable")
        self.assertEqual(runtime.promotion(), before_rollback)

    def test_refuses_inference_until_a_candidate_is_explicitly_promoted(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=2, max_seconds=5)["id"],
        )
        self.assertEqual(finished["state"], "succeeded")

        with self.assertRaises(ValueError):
            runtime.evaluate(self._request())

    def test_backend_receives_no_free_form_task_or_question_text(self):
        backend = CapturingBackend()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": backend},
            environment="test",
        )
        self.addCleanup(runtime.close)
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(finished["candidateId"], promoted_by="test-operator")
        runtime.evaluate(self._request())

        self.assertEqual(
            backend.request,
            {
                "images": [
                    "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
                ],
                "questions": {RULE: {"type": "noul"}},
            },
        )

    def test_detects_a_candidate_changed_to_claim_production_eligibility(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
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
        )
        for limits in invalid_limits:
            with self.subTest(**limits):
                with self.assertRaises(ValueError):
                    runtime.submit(backend="fixture", **limits)

        self.assertEqual(self._tree_snapshot(self.state_dir), before)

    def test_refuses_an_empty_backend_configuration(self):
        with self.assertRaises(RuntimeFailure) as missing:
            LocalRuntime(self.state_dir, self.taskset_dir, backends={})

        self.assertEqual(missing.exception.code, "backend_missing")

    def test_refuses_a_non_string_backend_as_invalid_input(self):
        runtime = self._runtime()

        with self.assertRaises(RuntimeFailure) as invalid:
            runtime.submit(backend={"fixture": True}, max_updates=1, max_seconds=1)

        self.assertEqual(invalid.exception.code, "invalid_input")
        self.assertEqual(invalid.exception.status, 400)

    def test_refuses_a_second_runtime_without_changing_the_first_jobs(self):
        runtime = self._runtime()
        submitted = runtime.submit(backend="fixture", max_updates=8, max_seconds=5)

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

        submitted = runtime.submit(backend="slow", max_updates=1, max_seconds=1)
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["error"]["code"], "job_timed_out")
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertEqual(multiprocessing.active_children(), [])

    def test_close_cancels_queued_jobs_instead_of_starting_them(self):
        backend = BlockingBackend()
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"blocking": backend},
            environment="test",
        )
        first = runtime.submit(backend="blocking", max_updates=1, max_seconds=5)
        self.assertTrue(backend.started.wait(5))
        second = runtime.submit(backend="blocking", max_updates=1, max_seconds=5)
        closing = threading.Thread(target=runtime.close)
        closing.start()
        time.sleep(0.05)
        backend.release.set()
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

    def test_persists_backend_failure_without_creating_a_candidate(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"failed": FailingBackend()},
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(backend="failed", max_updates=1, max_seconds=5)
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertNotIn("candidateId", failed)
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
            submitted = runtime.submit(backend="fixture", max_updates=1, max_seconds=5)
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
            runtime.submit(backend="fixture", max_updates=4, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        first_candidate = first["candidateId"]
        second_candidate = second["candidateId"]
        self.assertNotEqual(first_candidate, second_candidate)

        first_promotion = runtime.promote(first_candidate, promoted_by="first-operator")
        second_promotion = runtime.promote(second_candidate, promoted_by="second-operator")
        repeated = runtime.promote(second_candidate, promoted_by="retrying-operator")
        rollback = runtime.rollback(rolled_back_by="rollback-operator")

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
            runtime.submit(backend="fixture", max_updates=4, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        first_promotion = runtime.promote(
            first["candidateId"], promoted_by="first-operator"
        )
        second_promotion = runtime.promote(
            second["candidateId"], promoted_by="second-operator"
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
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        original = runtime._write_promotion

        def fail_pointer(promotion):
            with mock.patch(
                "replica_brand_check.runtime._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(promotion)

        with mock.patch.object(runtime, "_write_promotion", side_effect=fail_pointer):
            with self.assertRaises(OSError):
                runtime.promote(finished["candidateId"], promoted_by="test-operator")

        recovered = runtime.promote(
            finished["candidateId"], promoted_by="retrying-operator"
        )
        self.assertEqual(recovered["generation"], 1)
        self.assertEqual(recovered["candidateId"], finished["candidateId"])

    def test_rollback_retry_returns_the_recovered_generation(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=4, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(first["candidateId"], promoted_by="test-operator")
        runtime.promote(second["candidateId"], promoted_by="test-operator")
        original = runtime._write_promotion

        def fail_pointer(promotion):
            with mock.patch(
                "replica_brand_check.runtime._write_json_atomic",
                side_effect=OSError("pointer unavailable"),
            ):
                original(promotion)

        with mock.patch.object(runtime, "_write_promotion", side_effect=fail_pointer):
            with self.assertRaises(OSError):
                runtime.rollback(rolled_back_by="test-operator")

        recovered = runtime.rollback(rolled_back_by="retrying-operator")
        self.assertEqual(recovered["generation"], 3)
        self.assertEqual(recovered["candidateId"], first["candidateId"])
        self.assertEqual(recovered["operation"], "rollback")

    def test_production_rejects_fixture_promotion_without_changing_the_current_generation(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=2, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(first["candidateId"], promoted_by="test-operator")
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
            production.promote(second["candidateId"], promoted_by="production-operator")

        self.assertEqual(refused.exception.code, "candidate_not_production_eligible")
        self.assertEqual(refused.exception.status, 409)
        self.assertEqual(production.promotion(), before)
        with self.assertRaises(RuntimeFailure) as not_ready:
            production.ready()
        self.assertEqual(not_ready.exception.code, "candidate_not_production_eligible")
        with self.assertRaises(RuntimeFailure) as not_served:
            production.evaluate(self._request())
        self.assertEqual(not_served.exception.code, "candidate_not_production_eligible")

    def test_production_rejects_rollback_to_a_fixture_candidate(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=2, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(first["candidateId"], promoted_by="first-operator")
        runtime.promote(second["candidateId"], promoted_by="second-operator")
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
            production.rollback(rolled_back_by="production-operator")

        self.assertEqual(refused.exception.code, "candidate_not_production_eligible")
        self.assertEqual(refused.exception.status, 409)
        self.assertEqual(production.promotion(), before)

    def test_reopened_runtime_refuses_a_promoted_candidate_from_another_taskset(self):
        runtime = self._runtime()
        first = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=4, max_seconds=5)["id"],
        )
        second = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(first["candidateId"], promoted_by="test-operator")
        runtime.promote(second["candidateId"], promoted_by="test-operator")
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
            reopened.rollback(rolled_back_by="test-operator")

        self.assertEqual(not_ready.exception.code, "candidate_mismatch")
        self.assertEqual(not_served.exception.code, "candidate_mismatch")
        self.assertEqual(not_rolled_back.exception.code, "candidate_mismatch")

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
            {"backend": "fixture", "maxUpdates": 2, "maxSeconds": 5}
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
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        second = self._http_json(
            request.Request(
                f"{base_url}/v1/jobs",
                data=json.dumps(
                    {"backend": "fixture", "maxUpdates": 8, "maxSeconds": 5}
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
                    }
                ).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        rollback = self._http_json(
            request.Request(
                f"{base_url}/v1/rollbacks",
                data=json.dumps({"rolledBackBy": "test-operator"}).encode(),
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
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

    def test_header_deadline_releases_a_connection_slot(self):
        runtime = self._runtime()
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
        self.assertEqual(
            self._http_json(f"http://127.0.0.1:{server.server_address[1]}/health"),
            {"status": "healthy"},
        )

    def test_unknown_calibration_is_not_reported_as_not_worse(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        report = runtime.candidate(finished["candidateId"])["evaluation"]
        report["baseline"]["noul"]["ece"] = None
        report["candidate"]["noul"]["ece"] = None
        from replica_brand_check.runtime import _candidate_evaluation

        compared = _candidate_evaluation(
            runtime.taskset_digest, report["baseline"], report["candidate"]
        )
        self.assertIsNone(compared["evidence"]["calibrationErrorDelta"])
        self.assertIsNone(compared["evidence"]["calibrationNotWorse"])

    def test_refuses_malformed_questions_before_calling_the_backend(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        runtime.promote(finished["candidateId"], promoted_by="test-operator")
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
            runtime.submit(backend="fixture", max_updates=8, max_seconds=5)["id"],
        )
        with mock.patch("replica_brand_check.runtime.os.link", side_effect=OSError("stopped")):
            with self.assertRaises(OSError):
                runtime.promote(finished["candidateId"], promoted_by="test-operator")

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
