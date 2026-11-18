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
    Usage,
)


@dataclass(frozen=True)
class ConnectorConformanceFixture:
    """Fresh connectors and inspection hooks used by the shared contract checks."""

    connectors: RuntimeConnectors
    scope: RuntimeScope
    other_scope: RuntimeScope
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
        resolved = fixture.connectors.tasksets.resolve(
            fixture.taskset_reference, _context(fixture.scope, "resolve")
        )
        case.assertEqual(resolved.reference, fixture.taskset_reference)
        with case.assertRaises(ConnectorError) as hidden:
            fixture.connectors.tasksets.resolve(
                fixture.taskset_reference, _context(fixture.other_scope, "resolve-other")
            )
        case.assertEqual(hidden.exception.category, "not_found")

    return run


def _immutable_artifacts(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "artifact")
        artifact = _artifact(b"first")
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
                candidate.id, _context(fixture.other_scope, "candidate-other")
            )
        case.assertEqual(hidden.exception.category, "not_found")

    return run


def _leases(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "lease")
        fixture.connectors.jobs.create("job_lease", {"state": "queued"}, context)
        first = fixture.connectors.jobs.acquire(
            "job_lease", ttl_seconds=0.01, context=context
        )
        with case.assertRaises(ConnectorError) as conflict:
            fixture.connectors.jobs.acquire(
                "job_lease",
                ttl_seconds=1,
                context=_context(fixture.scope, "lease-conflict"),
            )
        case.assertEqual(conflict.exception.category, "conflict")
        time.sleep(0.02)
        second = fixture.connectors.jobs.acquire(
            "job_lease",
            ttl_seconds=1,
            context=_context(fixture.scope, "lease-after-expiry"),
        )
        case.assertNotEqual(first.token, second.token)

    return run


def _promotion_generations(create_fixture):
    def run(case):
        fixture = create_fixture()
        context = _context(fixture.scope, "promotion")
        first = fixture.connectors.candidates.put(_candidate("one"), context)
        second = fixture.connectors.candidates.put(_candidate("two"), context)
        generation_one = fixture.connectors.candidates.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=context,
        )
        case.assertEqual(generation_one.generation, 1)
        repeated = fixture.connectors.candidates.promote(
            first.id,
            expected_generation=1,
            operation="promote",
            context=context,
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
        cancelled = fixture.connectors.jobs.cancel(
            "job_cancel",
            expected_version=created["version"],
            context=context,
        )
        case.assertEqual(cancelled["state"], "cancelled")
        case.assertEqual(
            fixture.connectors.jobs.cancel(
                "job_cancel",
                expected_version=cancelled["version"],
                context=context,
            ),
            cancelled,
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
                context=_context(fixture.scope, "advance-cancelled"),
            )
        case.assertEqual(advanced.exception.category, "conflict")

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
            "training", _context(fixture.other_scope, "credential-other")
        )
        case.assertNotEqual(credential.value, other.value)

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
        mismatched = Usage(
            operation_id="another-operation",
            scope=fixture.other_scope,
            connector="training",
            kind="gpu_seconds",
            quantity=1,
            unit="seconds",
        )
        with case.assertRaises(ConnectorError) as refused:
            fixture.connectors.observability.record(mismatched, context)
        case.assertIn(refused.exception.category, ("invalid_input", "conflict"))

    return run


def _execution_context(create_fixture):
    def run(case):
        fixture = create_fixture()
        taskset = fixture.connectors.tasksets.resolve(
            fixture.taskset_reference, _context(fixture.scope, "execution-taskset")
        ).taskset
        case.assertTrue(fixture.connectors.training)
        case.assertTrue(fixture.connectors.inference)
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
