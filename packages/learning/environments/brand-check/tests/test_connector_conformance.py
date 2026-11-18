"""Provider-neutral connector contracts for the customer-operated runtime."""

from __future__ import annotations

import hashlib
import io
import json
import time
import unittest
from dataclasses import replace
from pathlib import Path

from replica_brand_check.connector_conformance import (
    ConnectorConformanceFixture,
    connector_conformance,
)
from replica_brand_check.connectors import (
    CONNECTOR_ERROR_CATEGORIES,
    Artifact,
    Cancellation,
    Candidate,
    ConnectorError,
    ContentDigest,
    Credential,
    JobLease,
    OperationContext,
    Promotion,
    RuntimeConnectors,
    RuntimeOwner,
    RuntimeScope,
    TasksetArtifact,
    Usage,
)
from replica_brand_check.taskset import Taskset


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def _context(
    scope: RuntimeScope,
    operation_id: str,
    *,
    key: str | None = None,
    deadline: float | None = None,
    cancellation: Cancellation | None = None,
) -> OperationContext:
    return OperationContext(
        operation_id=operation_id,
        idempotency_key=key or operation_id,
        scope=scope,
        owner=RuntimeOwner("worker", "contract-test"),
        deadline=deadline if deadline is not None else time.monotonic() + 5,
        cancellation=cancellation or Cancellation(),
    )


def _check_context(context: OperationContext) -> None:
    context.cancellation.raise_if_requested()
    if time.monotonic() >= context.deadline:
        raise ConnectorError(
            "operation_deadline_exceeded",
            "The operation deadline elapsed.",
            category="deadline_exceeded",
        )


def _scope_key(scope: RuntimeScope) -> tuple[str, str]:
    return scope.tenant_id, scope.repository


class _MemoryTasksets:
    def __init__(self, scope: RuntimeScope, reference: str, taskset: Taskset):
        self._items = {(_scope_key(scope), reference): taskset}

    def resolve(self, reference, context):
        _check_context(context)
        taskset = self._items.get((_scope_key(context.scope), reference))
        if taskset is None:
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            )
        return TasksetArtifact(reference, _digest(reference.encode()), taskset)


class _MemoryArtifacts:
    def __init__(self):
        self._items = {}

    def put(self, artifact, context):
        _check_context(context)
        if artifact.digest != _digest(artifact.data):
            raise ConnectorError(
                "artifact_digest_mismatch",
                "The artifact does not match its digest.",
                category="integrity",
            )
        key = (_scope_key(context.scope), str(artifact.digest))
        existing = self._items.get(key)
        if existing is not None and existing != artifact:
            raise ConnectorError(
                "artifact_immutable",
                "The artifact digest already identifies different content.",
                category="integrity",
            )
        self._items[key] = artifact
        return artifact

    def get(self, digest, context):
        _check_context(context)
        try:
            return self._items[(_scope_key(context.scope), str(digest))]
        except KeyError:
            raise ConnectorError(
                "artifact_not_found",
                "The artifact was not found.",
                category="not_found",
            ) from None


class _MemoryJobs:
    def __init__(self):
        self._jobs = {}
        self._versions = {}
        self._idempotency = {}
        self._leases = {}
        self._next_token = 0

    def create(self, job_id, record, context):
        _check_context(context)
        scope = _scope_key(context.scope)
        request = json.dumps(record, sort_keys=True, separators=(",", ":"))
        retry_key = (scope, context.idempotency_key)
        prior = self._idempotency.get(retry_key)
        if prior is not None:
            if prior[0] != (job_id, request):
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key was reused with different input.",
                    category="conflict",
                )
            return dict(prior[1])
        key = (scope, job_id)
        if key in self._jobs:
            raise ConnectorError(
                "job_exists",
                "The job already exists.",
                category="conflict",
            )
        saved = dict(record, version=1)
        self._jobs[key] = saved
        self._versions[key] = 1
        self._idempotency[retry_key] = ((job_id, request), saved)
        return dict(saved)

    def get(self, job_id, context):
        _check_context(context)
        try:
            return dict(self._jobs[(_scope_key(context.scope), job_id)])
        except KeyError:
            raise ConnectorError(
                "job_not_found", "The job was not found.", category="not_found"
            ) from None

    def list(self, states, context):
        _check_context(context)
        scope = _scope_key(context.scope)
        selected = set(states)
        return tuple(
            dict(record)
            for (record_scope, _job_id), record in sorted(self._jobs.items())
            if record_scope == scope and record.get("state") in selected
        )

    def update(self, job_id, record, *, expected_version, context):
        _check_context(context)
        key = (_scope_key(context.scope), job_id)
        if key not in self._jobs:
            raise ConnectorError(
                "job_not_found", "The job was not found.", category="not_found"
            )
        if self._jobs[key].get("state") == "cancelled":
            raise ConnectorError(
                "job_cancelled",
                "A cancelled job cannot advance.",
                category="conflict",
            )
        if self._versions[key] != expected_version:
            raise ConnectorError(
                "job_version_conflict",
                "The job changed before this update.",
                category="conflict",
            )
        version = expected_version + 1
        saved = dict(record, version=version)
        self._jobs[key] = saved
        self._versions[key] = version
        return dict(saved)

    def cancel(self, job_id, *, expected_version, context):
        _check_context(context)
        key = (_scope_key(context.scope), job_id)
        if key not in self._jobs:
            raise ConnectorError(
                "job_not_found", "The job was not found.", category="not_found"
            )
        current = self._jobs[key]
        if self._versions[key] != expected_version:
            raise ConnectorError(
                "job_version_conflict",
                "The job changed before cancellation.",
                category="conflict",
            )
        if current.get("state") == "cancelled":
            return dict(current)
        cancelled = dict(current, state="cancelled", version=expected_version + 1)
        self._jobs[key] = cancelled
        self._versions[key] = expected_version + 1
        return dict(cancelled)

    def acquire(self, job_id, *, ttl_seconds, context):
        _check_context(context)
        job = self.get(job_id, context)
        if job.get("state") == "cancelled":
            raise ConnectorError(
                "job_cancelled",
                "A cancelled job cannot be leased.",
                category="conflict",
            )
        key = (_scope_key(context.scope), job_id)
        now = time.monotonic()
        current = self._leases.get(key)
        if current is not None and current.expires_at > now:
            raise ConnectorError(
                "job_lease_conflict",
                "Another worker holds the job lease.",
                category="conflict",
            )
        self._next_token += 1
        lease = JobLease(
            job_id,
            f"lease-{self._next_token}",
            context.owner,
            now + ttl_seconds,
        )
        self._leases[key] = lease
        return lease

    def renew(self, lease, *, ttl_seconds, context):
        _check_context(context)
        key = (_scope_key(context.scope), lease.job_id)
        if self._leases.get(key) != lease or lease.expires_at <= time.monotonic():
            raise ConnectorError(
                "job_lease_lost",
                "The job lease is no longer owned by this worker.",
                category="conflict",
            )
        renewed = replace(lease, expires_at=time.monotonic() + ttl_seconds)
        self._leases[key] = renewed
        return renewed

    def release(self, lease, context):
        _check_context(context)
        key = (_scope_key(context.scope), lease.job_id)
        if self._leases.get(key) != lease:
            raise ConnectorError(
                "job_lease_lost",
                "The job lease is no longer owned by this worker.",
                category="conflict",
            )
        del self._leases[key]


class _MemoryCandidates:
    def __init__(self):
        self._items = {}
        self._promotions = {}

    def put(self, candidate, context):
        _check_context(context)
        for artifact in candidate.artifacts:
            if artifact.digest != _digest(artifact.data):
                raise ConnectorError(
                    "candidate_digest_mismatch",
                    "A candidate artifact does not match its digest.",
                    category="integrity",
                )
        key = (_scope_key(context.scope), candidate.id)
        existing = self._items.get(key)
        if existing is not None and existing != candidate:
            raise ConnectorError(
                "candidate_immutable",
                "The candidate ID already identifies different content.",
                category="integrity",
            )
        self._items[key] = candidate
        return candidate

    def get(self, candidate_id, context):
        _check_context(context)
        try:
            return self._items[(_scope_key(context.scope), candidate_id)]
        except KeyError:
            raise ConnectorError(
                "candidate_not_found",
                "The candidate was not found.",
                category="not_found",
            ) from None

    def promote(
        self,
        candidate_id,
        *,
        expected_generation,
        operation,
        context,
    ):
        _check_context(context)
        self.get(candidate_id, context)
        scope = _scope_key(context.scope)
        current = self._promotions.get(scope)
        if current is not None and current.candidate_id == candidate_id:
            return current
        generation = current.generation if current is not None else 0
        if generation != expected_generation:
            raise ConnectorError(
                "promotion_generation_conflict",
                "The promotion generation changed.",
                category="conflict",
            )
        promoted = Promotion(
            generation + 1,
            candidate_id,
            current.candidate_id if current is not None else None,
            operation,
            context.owner,
        )
        self._promotions[scope] = promoted
        return promoted

    def current(self, context):
        _check_context(context)
        return self._promotions.get(_scope_key(context.scope))


class _MemoryExecution:
    name = "contract"
    production_eligible = True

    def __init__(self):
        self.training_contexts = []
        self.inference_contexts = []

    def train(
        self,
        taskset,
        work_directory,
        *,
        max_updates,
        context,
        credential,
    ):
        del taskset, work_directory, max_updates
        _check_context(context)
        _check_credential(credential, "training", context)
        self.training_contexts.append(context)
        return {"operationId": context.operation_id}

    def predict(self, adapter, request, *, context, credential):
        del adapter, request
        _check_context(context)
        _check_credential(credential, "inference", context)
        self.inference_contexts.append(context)
        return {"operationId": context.operation_id}


def _check_credential(
    credential: Credential | None,
    audience: str,
    context: OperationContext,
) -> None:
    if (
        credential is None
        or credential.audience != audience
        or credential.scope != context.scope
        or credential.operation_id != context.operation_id
        or credential.expires_at > context.deadline
        or credential.expires_at <= time.monotonic()
    ):
        raise ConnectorError(
            "credential_invalid",
            "The credential does not cover this operation.",
            category="unauthorized",
        )


class _MemoryCredentials:
    def acquire(self, audience, context):
        _check_context(context)
        expires_at = min(context.deadline, time.monotonic() + 60)
        value = hashlib.sha256(
            (
                f"{context.scope.tenant_id}\0{context.scope.repository}\0"
                f"{context.operation_id}\0{audience}"
            ).encode()
        ).hexdigest()
        return Credential(
            value,
            expires_at,
            audience,
            context.scope,
            context.operation_id,
        )


class _MemoryObservability:
    def __init__(self):
        self.events = []

    def record(self, usage, context):
        _check_context(context)
        if usage.operation_id != context.operation_id or usage.scope != context.scope:
            raise ConnectorError(
                "usage_scope_mismatch",
                "Usage must be attributed to the current scoped operation.",
                category="invalid_input",
            )
        self.events.append(usage)


class _MemoryBundle:
    def __init__(self):
        self.scope = RuntimeScope("tenant-one", "octo/example")
        self.other_scope = RuntimeScope("tenant-two", "octo/example")
        self.taskset = Taskset(Path("."), {}, (), {}, {"train": (), "dev": (), "test": ()})
        self.taskset_reference = "taskset:contract"
        self.execution = _MemoryExecution()
        self.observability = _MemoryObservability()
        self.connectors = RuntimeConnectors(
            tasksets=_MemoryTasksets(
                self.scope,
                self.taskset_reference,
                self.taskset,
            ),
            artifacts=_MemoryArtifacts(),
            jobs=_MemoryJobs(),
            candidates=_MemoryCandidates(),
            training={"contract": self.execution},
            inference={"contract": self.execution},
            credentials=_MemoryCredentials(),
            observability=self.observability,
        )

    def fixture(self):
        return ConnectorConformanceFixture(
            connectors=self.connectors,
            scope=self.scope,
            other_scope=self.other_scope,
            taskset_reference=self.taskset_reference,
            usage=lambda: tuple(self.observability.events),
        )


class _MutableUnscopedCandidates(_MemoryCandidates):
    def put(self, candidate, context):
        _check_context(context)
        self._items[("shared", candidate.id)] = candidate
        return candidate

    def get(self, candidate_id, context):
        _check_context(context)
        try:
            return self._items[("shared", candidate_id)]
        except KeyError:
            raise ConnectorError(
                "candidate_not_found",
                "The candidate was not found.",
                category="not_found",
            ) from None


class _CancellationBlindJobs(_MemoryJobs):
    def acquire(self, job_id, *, ttl_seconds, context):
        return super().acquire(
            job_id,
            ttl_seconds=ttl_seconds,
            context=replace(context, cancellation=Cancellation()),
        )

    def release(self, lease, context):
        return super().release(
            lease,
            replace(context, cancellation=Cancellation()),
        )


class _NonIdempotentCancellationJobs(_MemoryJobs):
    def cancel(self, job_id, *, expected_version, context):
        key = (_scope_key(context.scope), job_id)
        if key in self._jobs and self._jobs[key].get("state") == "cancelled":
            raise ConnectorError(
                "job_already_cancelled",
                "The job was already cancelled.",
                category="conflict",
            )
        return super().cancel(
            job_id,
            expected_version=expected_version,
            context=context,
        )


class _StaleCancellationJobs(_MemoryJobs):
    def cancel(self, job_id, *, expected_version, context):
        key = (_scope_key(context.scope), job_id)
        return super().cancel(
            job_id,
            expected_version=self._versions.get(key, expected_version),
            context=context,
        )


class _CancelledLeaseJobs(_MemoryJobs):
    def acquire(self, job_id, *, ttl_seconds, context):
        key = (_scope_key(context.scope), job_id)
        current = self._jobs.get(key)
        if current is not None and current.get("state") == "cancelled":
            self._jobs[key] = dict(current, state="queued")
            try:
                return super().acquire(
                    job_id,
                    ttl_seconds=ttl_seconds,
                    context=context,
                )
            finally:
                self._jobs[key] = current
        return super().acquire(job_id, ttl_seconds=ttl_seconds, context=context)


class _CancelledUpdateJobs(_MemoryJobs):
    def update(self, job_id, record, *, expected_version, context):
        key = (_scope_key(context.scope), job_id)
        current = self._jobs.get(key)
        if current is not None and current.get("state") == "cancelled":
            self._jobs[key] = dict(current, state="queued")
            try:
                return super().update(
                    job_id,
                    record,
                    expected_version=expected_version,
                    context=context,
                )
            finally:
                self._jobs[key] = current
        return super().update(
            job_id,
            record,
            expected_version=expected_version,
            context=context,
        )


class _DeadlineBlindExecution(_MemoryExecution):
    def train(
        self,
        taskset,
        work_directory,
        *,
        max_updates,
        context,
        credential,
    ):
        del taskset, work_directory, max_updates, credential
        return {"operationId": context.operation_id}

    def predict(self, adapter, request, *, context, credential):
        del adapter, request, credential
        return {"operationId": context.operation_id}


class _UnboundedCredentials(_MemoryCredentials):
    def acquire(self, audience, context):
        _check_context(context)
        return Credential(
            f"{context.operation_id}:{audience}",
            context.deadline + 60,
            audience,
            context.scope,
            context.operation_id,
        )


class _UnattributedObservability(_MemoryObservability):
    def record(self, usage, context):
        _check_context(context)
        self.events.append(usage)


def _bundle_with(**overrides):
    bundle = _MemoryBundle()
    for field, connector in overrides.items():
        if field == "execution":
            bundle.execution = connector
            bundle.connectors = replace(
                bundle.connectors,
                training={"contract": connector},
                inference={"contract": connector},
            )
        elif field == "observability":
            bundle.observability = connector
            bundle.connectors = replace(bundle.connectors, observability=connector)
        else:
            bundle.connectors = replace(bundle.connectors, **{field: connector})
    return bundle


class ConnectorConformanceTest(unittest.TestCase):
    def test_contract_only_bundle_passes_the_reusable_conformance_suite(self):
        result, output = self._run_suite(_MemoryBundle)

        self.assertTrue(result.wasSuccessful(), output)
        self.assertGreater(result.testsRun, 0)

    def test_shared_suite_rejects_mutable_unscoped_candidate_storage(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(candidates=_MutableUnscopedCandidates()),
            "candidate storage that overwrites an ID or crosses customer scope",
        )

    def test_shared_suite_rejects_lease_operations_that_ignore_cancellation(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_CancellationBlindJobs()),
            "lease acquisition or release after cancellation",
        )

    def test_shared_suite_requires_idempotent_durable_job_cancellation(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_NonIdempotentCancellationJobs()),
            "a repeated cancellation that conflicts instead of returning the cancelled job",
        )

    def test_shared_suite_rejects_job_cancellation_with_a_stale_version(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_StaleCancellationJobs()),
            "job cancellation that accepts a stale expected version",
        )

    def test_shared_suite_prevents_cancelled_jobs_from_acquiring_a_lease(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_CancelledLeaseJobs()),
            "lease acquisition after durable cancellation",
        )

    def test_shared_suite_prevents_cancelled_jobs_from_advancing_state(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_CancelledUpdateJobs()),
            "state advancement after durable cancellation",
        )

    def test_shared_suite_rejects_training_or_inference_that_ignores_context(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(execution=_DeadlineBlindExecution()),
            "training or inference that ignores cancellation and deadlines",
        )

    def test_shared_suite_rejects_credentials_that_outlive_the_operation(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(credentials=_UnboundedCredentials()),
            "credentials whose expiry exceeds the operation deadline",
        )

    def test_shared_suite_rejects_usage_without_operation_attribution(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(observability=_UnattributedObservability()),
            "usage accepted for another operation or customer scope",
        )

    def test_connector_errors_have_a_stable_provider_neutral_taxonomy(self):
        self.assertEqual(
            set(CONNECTOR_ERROR_CATEGORIES),
            {
                "invalid_input",
                "not_found",
                "conflict",
                "unauthorized",
                "integrity",
                "cancelled",
                "deadline_exceeded",
                "unavailable",
                "internal",
            },
        )
        failure = ConnectorError(
            "capacity_temporarily_unavailable",
            "Capacity is unavailable.",
            category="unavailable",
            retryable=True,
        )

        self.assertEqual(failure.code, "capacity_temporarily_unavailable")
        self.assertEqual(failure.category, "unavailable")
        self.assertTrue(failure.retryable)
        with self.assertRaises(ValueError):
            ConnectorError("provider_error", "No.", category="azure")

    def _assert_suite_rejects(self, create_bundle, regression):
        result, output = self._run_suite(create_bundle)
        self.assertFalse(
            result.wasSuccessful(),
            f"conformance suite accepted {regression}\n{output}",
        )

    def _run_suite(self, create_bundle):
        output = io.StringIO()
        result = unittest.TextTestRunner(stream=output, verbosity=0).run(
            connector_conformance(
                "memory-contract",
                lambda: create_bundle().fixture(),
            )
        )
        return result, output.getvalue()


if __name__ == "__main__":
    unittest.main()
