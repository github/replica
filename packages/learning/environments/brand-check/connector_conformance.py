"""Reusable conformance checks for decision-runtime infrastructure connectors."""

from __future__ import annotations

import hashlib
import time
import unittest
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

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
    TrainingResult,
    Usage,
)


@dataclass(frozen=True)
class ConnectorConformanceFixture:
    """Fresh connectors and inspection hooks used by the shared contract checks."""

    connectors: RuntimeConnectors
    scope: RuntimeScope
    other_repository_scope: RuntimeScope
    other_tenant_scope: RuntimeScope
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
            case("restricts credentials to scope and operation", _credentials(create_fixture)),
            case("attributes usage and cost to the operation", _usage(create_fixture)),
        ]
    )


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
            case.assertEqual(fixture.connectors.jobs.list((job["state"],), other), ())
            with case.assertRaises(ConnectorError) as hidden:
                fixture.connectors.candidates.get(candidate.id, other)
            case.assertEqual(hidden.exception.category, "not_found")
            case.assertIsNone(fixture.connectors.candidates.current(other))

    return run


def _immutable_artifacts(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "artifact")
        artifact = _artifact(b"first")
        unseen_mismatch = Artifact(_digest(b"claimed"), "application/octet-stream", b"actual")
        with case.assertRaises(ConnectorError) as mismatch:
            fixture.connectors.artifacts.put(unseen_mismatch, context)
        case.assertEqual(mismatch.exception.category, "integrity")
        with case.assertRaises(ConnectorError):
            fixture.connectors.artifacts.get(unseen_mismatch.digest, context)
        case.assertEqual(fixture.connectors.artifacts.put(artifact, context), artifact)
        case.assertEqual(fixture.connectors.artifacts.put(artifact, context), artifact)
        changed = Artifact(
            digest=artifact.digest,
            media_type=artifact.media_type,
            data=b"changed",
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.artifacts.put(changed, context)
        case.assertEqual(conflict.exception.category, "integrity")
        case.assertEqual(fixture.connectors.artifacts.get(artifact.digest, context), artifact)

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
        context = _context(fixture.scope, "lease")
        fixture.connectors.jobs.create("job_lease", {"state": "queued"}, context)
        first = fixture.connectors.jobs.acquire(
            "job_lease", ttl_seconds=5, context=context
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.jobs.acquire(
                "job_lease",
                ttl_seconds=1,
                context=_context(fixture.scope, "lease-conflict"),
            )
        case.assertEqual(conflict.exception.category, "conflict")
        fixture.connectors.jobs.release(first, context)
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
        first_promotion_context = _context(fixture.scope, "promotion-one")
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
        generation_two = fixture.connectors.candidates.promote(
            second.id,
            expected_generation=1,
            operation="promote",
            context=_context(fixture.scope, "promotion-two"),
        )
        case.assertEqual(generation_two.generation, 2)
        case.assertEqual(generation_two.previous_candidate_id, first.id)
        with case.assertRaises(ConnectorError) as stale:
            fixture.connectors.candidates.promote(
                first.id,
                expected_generation=1,
                operation="rollback",
                context=_context(fixture.scope, "stale-promotion"),
            )
        case.assertEqual(stale.exception.category, "conflict")

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
        context = _context(fixture.scope, "cancel-job")
        created = fixture.connectors.jobs.create(
            "job_cancel", {"state": "queued"}, context
        )
        lease = fixture.connectors.jobs.acquire(
            "job_cancel",
            ttl_seconds=5,
            context=_context(fixture.scope, "cancel-job-lease"),
        )
        cancelled = fixture.connectors.jobs.cancel(
            "job_cancel",
            expected_version=created["version"],
            context=context,
        )
        case.assertEqual(cancelled["state"], "cancelled")
        case.assertEqual(
            fixture.connectors.jobs.cancel(
                "job_cancel",
                expected_version=created["version"],
                context=context,
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
        with case.assertRaises(ConnectorError) as advanced:
            fixture.connectors.jobs.update(
                "job_cancel",
                {"state": "running"},
                expected_version=cancelled["version"],
                lease=lease,
                context=_context(fixture.scope, "advance-cancelled"),
            )
        case.assertEqual(advanced.exception.category, "conflict")

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
            ttl_seconds=0.05,
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
        time.sleep(max(0, lease.expires_at - time.monotonic()) + 0.01)
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
                lease=lease,
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
        other = fixture.connectors.credentials.acquire(
            "training",
            _context(fixture.other_tenant_scope, "credential-other"),
        )
        case.assertFalse(
            credential.value == other.value,
            "Credential values must differ across scopes.",
        )

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
        for connector in fixture.connectors.training.values():
            result = connector.train(
                taskset,
                Path("."),
                max_updates=1,
                context=training_context,
                credential=training_credential,
            )
            case.assertIsInstance(result, TrainingResult)
            case.assertEqual(result.updates_completed, 1)
            case.assertTrue(result.adapter)
        cancelled = Cancellation()
        cancelled.cancel()
        for connector in fixture.connectors.training.values():
            with case.assertRaises(ConnectorError) as stopped:
                connector.train(
                    taskset,
                    Path("."),
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
) -> OperationContext:
    return OperationContext(
        operation_id=operation_id,
        idempotency_key=idempotency_key or operation_id,
        scope=scope,
        owner=RuntimeOwner("worker", "conformance"),
        deadline=deadline if deadline is not None else time.monotonic() + 5,
        cancellation=cancellation or Cancellation(),
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
