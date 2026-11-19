"""Reusable conformance checks for decision-runtime infrastructure connectors."""

from __future__ import annotations

import hashlib
import json
import time
import unittest
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import TemporaryDirectory

from .connectors import (
    Artifact,
    Candidate,
    Cancellation,
    ConnectorError,
    ContentDigest,
    OperationContext,
    RuntimeConnectors,
    RuntimeOwner,
    RuntimeScope,
    TasksetBundle,
    TrainingResult,
    Usage,
)
from .taskset import read_image


@dataclass(frozen=True)
class ConnectorConformanceFixture:
    """Fresh connectors and inspection hooks used by the shared contract checks."""

    connectors: RuntimeConnectors
    scope: RuntimeScope
    other_repository_scope: RuntimeScope
    other_tenant_scope: RuntimeScope
    taskset_bundle: TasksetBundle
    taskset_digest: ContentDigest
    taskset_reference: str
    usage: Callable[[], Sequence[Usage]]


def connector_conformance(
    name: str, create_fixture: Callable[[], ConnectorConformanceFixture]
) -> unittest.TestSuite:
    """Return a suite every local or hosted connector bundle must pass unchanged."""

    def case(label: str, body: Callable[[unittest.TestCase], None]) -> unittest.FunctionTestCase:
        return unittest.FunctionTestCase(
            lambda: body(unittest.TestCase()),
            description=f"{name}: {label}",
        )

    return unittest.TestSuite(
        [
            case(
                "registers immutable scoped tasksets",
                _taskset_registration(create_fixture),
            ),
            case("isolates tenant and repository scope", _scope_isolation(create_fixture)),
            case("stores immutable content by digest", _immutable_artifacts(create_fixture)),
            case("stores immutable scoped candidates", _immutable_candidates(create_fixture)),
            case(
                "makes retries idempotent and conflicting reuse explicit",
                _idempotency(create_fixture),
            ),
            case("expires exclusive job leases", _leases(create_fixture)),
            case(
                "honors cancellation during lease operations",
                _lease_cancellation(create_fixture),
            ),
            case(
                "cancels durable jobs with compare-and-swap",
                _job_cancellation(create_fixture),
            ),
            case(
                "fences versioned job updates with the active lease",
                _job_versioning(create_fixture),
            ),
            case(
                "advances promotion generations monotonically",
                _promotion_generations(create_fixture),
            ),
            case(
                "classifies cancellation and deadlines",
                _cancellation_and_deadlines(create_fixture),
            ),
            case(
                "propagates context through training and inference",
                _execution_context(create_fixture),
            ),
            case(
                "enforces hard training budgets and returns authoritative usage",
                _training_budget(create_fixture),
            ),
            case("restricts credentials to scope and operation", _credentials(create_fixture)),
            case("attributes usage and cost to the operation", _usage(create_fixture)),
        ]
    )


def _taskset_registration(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(
            fixture.scope,
            "taskset-register",
            idempotency_key="taskset-register",
        )
        registered = fixture.connectors.tasksets.register(
            fixture.taskset_bundle,
            context,
        )
        case.assertEqual(registered.digest, fixture.taskset_digest)
        case.assertEqual(registered.reference, f"taskset:{registered.digest.value}")
        case.assertEqual(
            _validated_taskset_digest(registered.taskset),
            fixture.taskset_digest,
        )
        case.assertEqual(
            {
                image.name: (image.media_type, image.digest, read_image(image))
                for task in registered.taskset.tasks
                for image in task.images
            },
            {
                image.path: (image.media_type, str(image.digest), image.data)
                for image in fixture.taskset_bundle.images
            },
        )
        case.assertEqual(
            fixture.connectors.tasksets.register(fixture.taskset_bundle, context),
            registered,
        )
        changed = replace(
            fixture.taskset_bundle,
            manifest={**fixture.taskset_bundle.manifest, "exportId": "changed"},
            digest=registered.digest,
        )
        with case.assertRaises(ConnectorError) as immutable:
            fixture.connectors.tasksets.register(
                changed,
                _context(
                    fixture.scope,
                    "taskset-register-changed",
                    idempotency_key="taskset-register-changed",
                ),
            )
        case.assertEqual(immutable.exception.category, "conflict")
        with case.assertRaises(ConnectorError) as retry_conflict:
            fixture.connectors.tasksets.register(
                changed,
                _context(
                    fixture.scope,
                    "taskset-register-reused-key",
                    idempotency_key="taskset-register",
                ),
            )
        case.assertEqual(retry_conflict.exception.category, "conflict")
        incorrect_digest = replace(
            fixture.taskset_bundle,
            digest=ContentDigest("sha256", "0" * 64),
        )
        with case.assertRaises(ConnectorError) as mismatch:
            fixture.connectors.tasksets.register(
                incorrect_digest,
                _context(
                    fixture.scope,
                    "taskset-register-wrong-digest",
                    idempotency_key="taskset-register-wrong-digest",
                ),
            )
        case.assertIn(mismatch.exception.category, ("conflict", "invalid_input"))
        case.assertEqual(
            fixture.connectors.tasksets.resolve(
                registered.reference,
                _context(fixture.scope, "taskset-resolve"),
            ),
            registered,
        )
        for label, scope in (
            ("repository", fixture.other_repository_scope),
            ("tenant", fixture.other_tenant_scope),
        ):
            with case.assertRaises(ConnectorError) as refused:
                fixture.connectors.tasksets.register(
                    fixture.taskset_bundle,
                    _context(scope, f"taskset-register-other-{label}"),
                )
            case.assertEqual(refused.exception.category, "unauthorized")
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.tasksets.resolve(
                    registered.reference,
                    _context(scope, f"taskset-resolve-other-{label}"),
                )
            case.assertEqual(hidden.exception.category, "not_found")

    return run


def _validated_taskset_digest(taskset) -> ContentDigest:
    identity = {
        "manifest": dict(taskset.metadata),
        "tasks": [
            {
                "id": task.id,
                "split": task.split,
                "state": dict(task.state),
                "images": [
                    {
                        "role": image.role,
                        "path": image.name,
                        "mediaType": image.media_type,
                        "digest": image.digest,
                        "size": image.size,
                        "theme": image.theme,
                    }
                    for image in task.images
                ],
                "questions": {
                    key: dict(question.spec) for key, question in task.questions.items()
                },
                "labels": dict(task.labels),
                "provenance": dict(task.provenance),
            }
            for task in taskset.tasks
        ],
    }
    data = (
        json.dumps(identity, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode()
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def _scope_isolation(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "scope")
        resolved = fixture.connectors.tasksets.resolve(
            fixture.taskset_reference, context
        )
        case.assertEqual(resolved.reference, fixture.taskset_reference)
        artifact = fixture.connectors.artifacts.put(_artifact(b"scoped"), context)
        job = fixture.connectors.jobs.create(
            "job_scoped", {"state": "queued"}, context
        )
        candidate = fixture.connectors.candidates.put(
            _candidate("scoped"), _context(fixture.scope, "scope-candidate")
        )
        fixture.connectors.candidates.promote(
            candidate.id,
            expected_generation=0,
            operation="promote",
            context=_context(fixture.scope, "scope-promotion"),
        )
        for label, scope in (
            ("repository", fixture.other_repository_scope),
            ("tenant", fixture.other_tenant_scope),
        ):
            other = _context(scope, f"scope-other-{label}")
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.tasksets.resolve(fixture.taskset_reference, other)
            case.assertEqual(hidden.exception.category, "not_found")
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.artifacts.get(artifact.digest, other)
            case.assertEqual(hidden.exception.category, "not_found")
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.jobs.get("job_scoped", other)
            case.assertEqual(hidden.exception.category, "not_found")
            case.assertFalse(fixture.connectors.jobs.list((job["state"],), other))
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.candidates.get(candidate.id, other)
            case.assertEqual(hidden.exception.category, "not_found")
            case.assertIsNone(fixture.connectors.candidates.current(other))

    return run


def _immutable_artifacts(create_fixture):
    def run(case):
        fixture = create_fixture()
        artifact = _artifact(b"first")
        unseen_mismatch = Artifact(_digest(b"claimed"), "application/octet-stream", b"actual")
        with case.assertRaises(ConnectorError) as mismatch:
            fixture.connectors.artifacts.put(
                unseen_mismatch,
                _context(fixture.scope, "artifact-mismatch"),
            )
        case.assertEqual(mismatch.exception.category, "integrity")
        with case.assertRaises(ConnectorError):
            fixture.connectors.artifacts.get(
                unseen_mismatch.digest,
                _context(fixture.scope, "artifact-mismatch-read"),
            )
        put_context = _context(fixture.scope, "artifact-put")
        case.assertEqual(fixture.connectors.artifacts.put(artifact, put_context), artifact)
        case.assertEqual(fixture.connectors.artifacts.put(artifact, put_context), artifact)
        changed = Artifact(
            digest=artifact.digest,
            media_type=artifact.media_type,
            data=b"changed",
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.artifacts.put(
                changed,
                _context(fixture.scope, "artifact-changed"),
            )
        case.assertEqual(conflict.exception.category, "integrity")
        case.assertEqual(
            fixture.connectors.artifacts.get(
                artifact.digest,
                _context(fixture.scope, "artifact-read"),
            ),
            artifact,
        )

    return run


def _idempotency(create_fixture):
    def run(case):
        fixture = create_fixture()
        first = _context(fixture.scope, "job", idempotency_key="stable-job")
        job = fixture.connectors.jobs.create("job_contract", {"state": "queued"}, first)
        case.assertEqual(
            fixture.connectors.jobs.create("job_contract", {"state": "queued"}, first),
            job,
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.jobs.create(
                "job_contract",
                {"state": "different"},
                _context(fixture.scope, "job-retry", idempotency_key="stable-job"),
            )
        case.assertEqual(conflict.exception.category, "conflict")

    return run


def _immutable_candidates(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "candidate")
        candidate = _candidate("immutable")
        case.assertEqual(fixture.connectors.candidates.put(candidate, context), candidate)
        case.assertEqual(fixture.connectors.candidates.put(candidate, context), candidate)
        changed = Candidate(
            id=candidate.id,
            digest=_digest(b"changed"),
            manifest={"name": "changed"},
            artifacts=(_artifact(b"changed"),),
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.candidates.put(changed, context)
        case.assertIn(conflict.exception.category, ("conflict", "integrity"))
        with case.assertRaises(ConnectorError) as hidden:
            fixture.connectors.candidates.get(
                candidate.id,
                _context(fixture.other_tenant_scope, "candidate-other"),
            )
        case.assertEqual(hidden.exception.category, "not_found")

    return run


def _leases(create_fixture):
    def run(case):
        fixture = create_fixture()
        fixture.connectors.jobs.create(
            "job_lease",
            {"state": "queued"},
            _context(fixture.scope, "lease-create"),
        )
        first = fixture.connectors.jobs.acquire(
            "job_lease",
            ttl_seconds=5,
            context=_context(fixture.scope, "lease-first"),
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.jobs.acquire(
                "job_lease",
                ttl_seconds=1,
                context=_context(fixture.scope, "lease-conflict"),
            )
        case.assertEqual(conflict.exception.category, "conflict")
        fixture.connectors.jobs.release(
            first,
            _context(fixture.scope, "lease-first-release"),
        )
        expiring = fixture.connectors.jobs.acquire(
            "job_lease",
            ttl_seconds=0.05,
            context=_context(fixture.scope, "lease-expiring"),
        )
        time.sleep(max(0, expiring.expires_at - time.monotonic()) + 0.01)
        second = fixture.connectors.jobs.acquire(
            "job_lease",
            ttl_seconds=1,
            context=_context(fixture.scope, "lease-after-expiry"),
        )
        case.assertNotEqual(expiring.token, second.token)
        with case.assertRaises(ConnectorError) as stale_renew:
            fixture.connectors.jobs.renew(
                expiring,
                ttl_seconds=1,
                context=_context(fixture.scope, "lease-stale-renew"),
            )
        case.assertEqual(stale_renew.exception.category, "conflict")
        with case.assertRaises(ConnectorError) as stale_release:
            fixture.connectors.jobs.release(
                expiring,
                _context(fixture.scope, "lease-stale-release"),
            )
        case.assertEqual(stale_release.exception.category, "conflict")
        fixture.connectors.jobs.release(
            second, _context(fixture.scope, "lease-current-release")
        )

    return run


def _promotion_generations(create_fixture):
    def run(case):
        fixture = create_fixture()
        first = fixture.connectors.candidates.put(
            _candidate("one"), _context(fixture.scope, "candidate-one")
        )
        second = fixture.connectors.candidates.put(
            _candidate("two"), _context(fixture.scope, "candidate-two")
        )
        first_promotion_context = _context(
            fixture.scope,
            "promotion-one",
            idempotency_key="promotion-one",
        )
        generation_one = fixture.connectors.candidates.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=first_promotion_context,
        )
        case.assertEqual(generation_one.generation, 1)
        repeated = fixture.connectors.candidates.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=first_promotion_context,
        )
        case.assertEqual(repeated, generation_one)
        with case.assertRaises(ConnectorError) as changed_owner:
            fixture.connectors.candidates.promote(
                first.id,
                expected_generation=0,
                operation="promote",
                context=replace(
                    first_promotion_context,
                    owner=RuntimeOwner("worker", "another-operator"),
                ),
            )
        case.assertEqual(changed_owner.exception.category, "conflict")
        generation_two = fixture.connectors.candidates.promote(
            second.id,
            expected_generation=1,
            operation="promote",
            context=_context(fixture.scope, "promotion-two"),
        )
        case.assertEqual(generation_two.generation, 2)
        case.assertEqual(generation_two.previous_candidate_id, first.id)
        case.assertEqual(
            fixture.connectors.candidates.promote(
                first.id,
                expected_generation=0,
                operation="promote",
                context=first_promotion_context,
            ),
            generation_one,
        )
        case.assertEqual(
            fixture.connectors.candidates.current(
                _context(fixture.scope, "promotion-current")
            ),
            generation_two,
        )
        with case.assertRaises(ConnectorError) as current_stale:
            fixture.connectors.candidates.promote(
                "candidate_missing",
                expected_generation=0,
                operation="promote",
                context=_context(fixture.scope, "current-candidate-stale"),
            )
        case.assertEqual(current_stale.exception.category, "conflict")
        with case.assertRaises(ConnectorError) as stale:
            fixture.connectors.candidates.promote(
                first.id,
                expected_generation=1,
                operation="rollback",
                context=_context(fixture.scope, "stale-promotion"),
            )
        case.assertEqual(stale.exception.category, "conflict")

    return run


def _training_budget(create_fixture):
    def run(case):
        fixture = create_fixture()
        for name, connector in fixture.connectors.training.items():
            context = _context(
                fixture.scope,
                f"training-budget-{name}",
                max_credits=1,
                budget_mode="hard",
            )
            credential = fixture.connectors.credentials.acquire("training", context)
            with TemporaryDirectory() as work:
                if connector.supports_hard_credit_budget:
                    result = connector.train(
                        fixture.connectors.tasksets.resolve(
                            fixture.taskset_reference,
                            context,
                        ).taskset,
                        Path(work),
                        max_updates=2,
                        context=context,
                        credential=credential,
                    )
                    case.assertTrue(result.usage)
                    credits = [
                        item
                        for item in result.usage
                        if item.kind == "training_credits" and item.unit == "credits"
                    ]
                    case.assertTrue(credits)
                    case.assertLessEqual(sum(item.quantity for item in credits), 1)
                    for item in result.usage:
                        case.assertEqual(item.operation_id, context.operation_id)
                        case.assertEqual(item.scope, context.scope)
                        case.assertEqual(item.connector, connector.name)
                        case.assertNotEqual(item.source, "estimate")
                        case.assertIsNotNone(item.cost)
                        case.assertIsInstance(item.currency, str)
                        case.assertTrue(item.currency.strip())
                else:
                    with case.assertRaises(ConnectorError) as unsupported:
                        connector.train(
                            fixture.connectors.tasksets.resolve(
                                fixture.taskset_reference,
                                context,
                            ).taskset,
                            Path(work),
                            max_updates=2,
                            context=context,
                            credential=credential,
                        )
                    case.assertEqual(
                        unsupported.exception.code, "hard_budget_unsupported"
                    )

    return run


def _lease_cancellation(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "lease-cancel")
        fixture.connectors.jobs.create("job_lease_cancel", {"state": "queued"}, context)
        cancelled = Cancellation()
        cancelled.cancel()
        with case.assertRaises(ConnectorError) as stopped:
            fixture.connectors.jobs.acquire(
                "job_lease_cancel",
                ttl_seconds=1,
                context=_context(
                    fixture.scope,
                    "cancelled-acquire",
                    cancellation=cancelled,
                ),
            )
        case.assertEqual(stopped.exception.category, "cancelled")
        lease = fixture.connectors.jobs.acquire(
            "job_lease_cancel",
            ttl_seconds=1,
            context=_context(fixture.scope, "active-acquire"),
        )
        with case.assertRaises(ConnectorError) as release:
            fixture.connectors.jobs.release(
                lease,
                _context(
                    fixture.scope,
                    "cancelled-release",
                    cancellation=cancelled,
                ),
            )
        case.assertEqual(release.exception.category, "cancelled")

    return run


def _job_cancellation(create_fixture):
    def run(case):
        fixture = create_fixture()
        created = fixture.connectors.jobs.create(
            "job_cancel",
            {"state": "queued"},
            _context(fixture.scope, "cancel-job-create"),
        )
        lease = fixture.connectors.jobs.acquire(
            "job_cancel",
            ttl_seconds=5,
            context=_context(fixture.scope, "cancel-job-lease"),
        )
        with case.assertRaises(ConnectorError) as cross_scope:
            fixture.connectors.jobs.cancel(
                "job_cancel",
                expected_version=created["version"],
                context=_context(
                    fixture.other_tenant_scope,
                    "cancel-job-other-tenant",
                ),
            )
        case.assertIn(cross_scope.exception.category, ("not_found", "unauthorized"))
        case.assertEqual(
            fixture.connectors.jobs.get(
                "job_cancel",
                _context(fixture.scope, "cancel-job-after-other-tenant"),
            ),
            created,
        )
        cancelled = fixture.connectors.jobs.cancel(
            "job_cancel",
            expected_version=created["version"],
            context=_context(
                fixture.scope,
                "cancel-job",
                idempotency_key="cancel-job",
            ),
        )
        case.assertEqual(cancelled["state"], "cancelled")
        case.assertEqual(
            fixture.connectors.jobs.cancel(
                "job_cancel",
                expected_version=created["version"],
                context=_context(
                    fixture.scope,
                    "cancel-job-retry",
                    idempotency_key="cancel-job",
                ),
            ),
            cancelled,
        )
        with case.assertRaises(ConnectorError) as advanced:
            fixture.connectors.jobs.update(
                "job_cancel",
                {"state": "running"},
                expected_version=cancelled["version"],
                lease=lease,
                context=_context(fixture.scope, "advance-cancelled"),
            )
        case.assertEqual(advanced.exception.category, "conflict")
        case.assertEqual(
            fixture.connectors.jobs.get(
                "job_cancel",
                _context(fixture.scope, "cancelled-read"),
            ),
            cancelled,
        )
        fixture.connectors.jobs.release(
            lease,
            _context(fixture.scope, "release-cancelled-job-lease"),
        )
        with case.assertRaises(ConnectorError) as stopped:
            fixture.connectors.jobs.acquire(
                "job_cancel",
                ttl_seconds=1,
                context=_context(fixture.scope, "lease-cancelled"),
            )
        case.assertEqual(stopped.exception.category, "conflict")
        with case.assertRaises(ConnectorError) as stale:
            fixture.connectors.jobs.cancel(
                "job_cancel",
                expected_version=created["version"],
                context=_context(fixture.scope, "stale-cancel"),
            )
        case.assertEqual(stale.exception.category, "conflict")
    return run


def _job_versioning(create_fixture):
    def run(case):
        fixture = create_fixture()
        created = fixture.connectors.jobs.create(
            "job_live",
            {"state": "queued"},
            _context(fixture.scope, "live-create"),
        )
        lease = fixture.connectors.jobs.acquire(
            "job_live",
            ttl_seconds=5,
            context=_context(fixture.scope, "live-lease"),
        )
        running = fixture.connectors.jobs.update(
            "job_live",
            {"state": "running"},
            expected_version=created["version"],
            lease=lease,
            context=_context(fixture.scope, "live-running"),
        )
        with case.assertRaises(ConnectorError) as stale:
            fixture.connectors.jobs.update(
                "job_live",
                {"state": "succeeded"},
                expected_version=created["version"],
                lease=lease,
                context=_context(fixture.scope, "live-stale"),
            )
        case.assertEqual(stale.exception.category, "conflict")
        running_context = _context(fixture.scope, "live-read")
        case.assertEqual(
            fixture.connectors.jobs.get("job_live", running_context),
            running,
        )
        fixture.connectors.jobs.release(
            lease,
            _context(fixture.scope, "live-version-release"),
        )
        expiring = fixture.connectors.jobs.acquire(
            "job_live",
            ttl_seconds=0.05,
            context=_context(fixture.scope, "live-expiring"),
        )
        time.sleep(max(0, expiring.expires_at - time.monotonic()) + 0.01)
        replacement = fixture.connectors.jobs.acquire(
            "job_live",
            ttl_seconds=1,
            context=_context(fixture.scope, "live-replacement"),
        )
        with case.assertRaises(ConnectorError) as fenced:
            fixture.connectors.jobs.update(
                "job_live",
                {"state": "succeeded"},
                expected_version=running["version"],
                lease=expiring,
                context=_context(fixture.scope, "live-stale-lease"),
            )
        case.assertEqual(fenced.exception.category, "conflict")
        case.assertEqual(
            fixture.connectors.jobs.get("job_live", running_context),
            running,
        )
        fixture.connectors.jobs.release(replacement, running_context)

    return run


def _cancellation_and_deadlines(create_fixture):
    def run(case):
        fixture = create_fixture()
        cancelled = Cancellation()
        cancelled.cancel()
        with case.assertRaises(ConnectorError) as stopped:
            fixture.connectors.tasksets.resolve(
                fixture.taskset_reference,
                _context(fixture.scope, "cancelled", cancellation=cancelled),
            )
        case.assertEqual(stopped.exception.category, "cancelled")
        with case.assertRaises(ConnectorError) as expired:
            fixture.connectors.tasksets.resolve(
                fixture.taskset_reference,
                _context(fixture.scope, "expired", deadline=time.monotonic() - 1),
            )
        case.assertEqual(expired.exception.category, "deadline_exceeded")
        case.assertFalse(stopped.exception.retryable)
        case.assertFalse(expired.exception.retryable)

    return run


def _credentials(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "credential")
        credential = fixture.connectors.credentials.acquire("training", context)
        if credential is None:
            return
        case.assertIsNotNone(credential)
        case.assertEqual(credential.scope, fixture.scope)
        case.assertEqual(credential.operation_id, context.operation_id)
        case.assertEqual(credential.audience, "training")
        case.assertGreater(credential.expires_at, time.monotonic())
        case.assertLessEqual(credential.expires_at, context.deadline)
        for label, scope in (
            ("repository", fixture.other_repository_scope),
            ("tenant", fixture.other_tenant_scope),
        ):
            with case.assertRaises(ConnectorError) as rejected:
                fixture.connectors.credentials.acquire(
                    "training",
                    _context(scope, f"credential-other-{label}"),
                )
            case.assertEqual(rejected.exception.category, "unauthorized")

    return run


def _usage(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "usage")
        usage = Usage(
            operation_id=context.operation_id,
            scope=fixture.scope,
            connector="training",
            kind="gpu_seconds",
            quantity=12,
            unit="seconds",
            cost=0.24,
            currency="USD",
        )
        fixture.connectors.observability.record(usage, context)
        case.assertEqual(list(fixture.usage()), [usage])
        for mismatch in (
            Usage(
                operation_id="another-operation",
                scope=fixture.scope,
                connector="training",
                kind="gpu_seconds",
                quantity=1,
                unit="seconds",
            ),
            Usage(
                operation_id=context.operation_id,
                scope=fixture.other_tenant_scope,
                connector="training",
                kind="gpu_seconds",
                quantity=1,
                unit="seconds",
            ),
        ):
            with case.assertRaises(ConnectorError) as refused:
                fixture.connectors.observability.record(mismatch, context)
            case.assertIn(refused.exception.category, ("invalid_input", "conflict"))
        case.assertEqual(list(fixture.usage()), [usage])

    return run


def _execution_context(create_fixture):
    def run(case):
        fixture = create_fixture()
        taskset = fixture.connectors.tasksets.resolve(
            fixture.taskset_reference, _context(fixture.scope, "execution-taskset")
        ).taskset
        case.assertTrue(fixture.connectors.training)
        case.assertTrue(fixture.connectors.inference)
        training_context = _context(fixture.scope, "successful-training")
        training_credential = fixture.connectors.credentials.acquire(
            "training", training_context
        )
        with TemporaryDirectory() as work:
            for connector in fixture.connectors.training.values():
                result = connector.train(
                    taskset,
                    Path(work),
                    max_updates=1,
                    context=training_context,
                    credential=training_credential,
                )
                case.assertIsInstance(result, TrainingResult)
                case.assertEqual(result.updates_completed, 1)
                case.assertTrue(result.adapter)
                adapter = Path(work) / result.adapter_name
                adapter.write_bytes(result.adapter)
                inference_context = _context(
                    fixture.scope,
                    "successful-inference",
                )
                inference_credential = fixture.connectors.credentials.acquire(
                    "inference",
                    inference_context,
                )
                prediction = fixture.connectors.inference[connector.name].predict(
                    adapter,
                    {"questions": {}},
                    context=inference_context,
                    credential=inference_credential,
                )
                case.assertEqual(
                    prediction["operationId"],
                    inference_context.operation_id,
                )
        cancelled = Cancellation()
        cancelled.cancel()
        with TemporaryDirectory() as work:
            for connector in fixture.connectors.training.values():
                with case.assertRaises(ConnectorError) as stopped:
                    connector.train(
                        taskset,
                        Path(work),
                        max_updates=1,
                        context=_context(
                            fixture.scope,
                            "cancelled-training",
                            cancellation=cancelled,
                        ),
                        credential=None,
                    )
                case.assertEqual(stopped.exception.category, "cancelled")
        for connector in fixture.connectors.inference.values():
            with case.assertRaises(ConnectorError) as expired:
                connector.predict(
                    Path("adapter"),
                    {"questions": {}},
                    context=_context(
                        fixture.scope,
                        "expired-inference",
                        deadline=time.monotonic() - 1,
                    ),
                    credential=None,
                )
            case.assertEqual(expired.exception.category, "deadline_exceeded")

    return run


def _context(
    scope: RuntimeScope,
    operation_id: str,
    *,
    idempotency_key: str | None = None,
    deadline: float | None = None,
    cancellation: Cancellation | None = None,
    max_credits: float | None = None,
    budget_mode: str = "none",
) -> OperationContext:
    return OperationContext(
        operation_id=operation_id,
        idempotency_key=idempotency_key or operation_id,
        scope=scope,
        owner=RuntimeOwner("worker", "conformance"),
        deadline=deadline if deadline is not None else time.monotonic() + 5,
        cancellation=cancellation or Cancellation(),
        max_credits=max_credits,
        budget_mode=budget_mode,
    )


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def _artifact(data: bytes) -> Artifact:
    return Artifact(_digest(data), "application/octet-stream", data)


def _candidate(name: str) -> Candidate:
    artifact = _artifact(name.encode())
    return Candidate(
        id=f"candidate_{name}",
        digest=_digest(name.encode()),
        manifest={"name": name, "digest": str(artifact.digest)},
        artifacts=(artifact,),
    )
