"""Provider-neutral connector contracts for the customer-operated runtime."""

from __future__ import annotations

import hashlib
import io
import json
import time
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

import replica_brand_check
from replica_brand_check.connector_conformance import (
    ConnectorConformanceFixture,
    connector_conformance,
)
from replica_brand_check.local_connectors import taskset_digest
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
    TasksetBundle,
    TasksetImage,
    TrainingResult,
    Usage,
)
from replica_brand_check.taskset import Taskset, load_taskset
from tests.support import PNG, make_task


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def _candidate(name: str) -> Candidate:
    artifact = Artifact(
        digest=_digest(name.encode()),
        media_type="application/octet-stream",
        data=name.encode(),
    )
    return Candidate(
        id=f"candidate_{name}",
        digest=_digest(f"candidate:{name}".encode()),
        manifest={"name": name, "artifact": str(artifact.digest)},
        artifacts=(artifact,),
    )


def _taskset_bundle():
    task = make_task(1)
    return TasksetBundle(
        manifest={
            "schemaVersion": "replica.decision-taskset/v1",
            "exportId": "export_contract",
            "createdAt": "2026-11-18T00:00:00Z",
            "counts": {"tasks": 1},
        },
        tasks=(task,),
        images=(
            TasksetImage(
                path="images/screen.png",
                media_type="image/png",
                digest=_digest(PNG),
                data=PNG,
            ),
        ),
    )


def _materialize_taskset(bundle: TasksetBundle) -> tuple[TemporaryDirectory, Taskset]:
    holder = TemporaryDirectory()
    directory = Path(holder.name)
    (directory / "taskset.json").write_text(
        json.dumps(bundle.manifest), encoding="utf-8"
    )
    (directory / "tasks.jsonl").write_text(
        "".join(json.dumps(task) + "\n" for task in bundle.tasks),
        encoding="utf-8",
    )
    for image in bundle.images:
        destination = directory / image.path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(image.data)
    return holder, load_taskset(directory)


def _context(
    scope: RuntimeScope,
    operation_id: str,
    *,
    key: str | None = None,
    deadline: float | None = None,
    cancellation: Cancellation | None = None,
    max_credits: float | None = None,
    budget_mode: str = "none",
) -> OperationContext:
    return OperationContext(
        operation_id=operation_id,
        idempotency_key=key or operation_id,
        scope=scope,
        owner=RuntimeOwner("worker", "contract-test"),
        deadline=deadline if deadline is not None else time.monotonic() + 5,
        cancellation=cancellation or Cancellation(),
        max_credits=max_credits,
        budget_mode=budget_mode,
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
    def __init__(
        self,
        scope: RuntimeScope,
        reference: str,
        taskset: Taskset,
        *,
        trust_claimed_digest: bool = False,
    ):
        self._scope = scope
        self._taskset = taskset
        self._items = {(_scope_key(scope), reference): taskset}
        self._registrations = {}
        self._idempotency = {}
        self._holders = []
        self._trust_claimed_digest = trust_claimed_digest

    def register(self, bundle, context):
        _check_context(context)
        if context.scope != self._scope:
            raise ConnectorError(
                "scope_unauthorized",
                "The operation scope does not match this connector bundle.",
                category="unauthorized",
            )
        identity = json.dumps(
            {
                "manifest": bundle.manifest,
                "tasks": list(bundle.tasks),
                "images": [
                    {
                        "path": image.path,
                        "mediaType": image.media_type,
                        "digest": str(image.digest),
                        "data": image.data.hex(),
                    }
                    for image in bundle.images
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        retry_key = (_scope_key(context.scope), context.idempotency_key)
        previous_retry = self._idempotency.get(retry_key)
        if previous_retry is not None and previous_retry != identity:
            raise ConnectorError(
                "idempotency_conflict",
                "The idempotency key was reused with different input.",
                category="conflict",
            )
        holder, taskset = _materialize_taskset(bundle)
        actual_digest = taskset_digest(taskset)
        digest = bundle.digest or actual_digest
        if bundle.digest is not None and bundle.digest != actual_digest:
            if not self._trust_claimed_digest:
                claimed_reference = f"taskset:{bundle.digest.value}"
                raise ConnectorError(
                    "taskset_immutable"
                    if (_scope_key(context.scope), claimed_reference)
                    in self._registrations
                    else "taskset_digest_mismatch",
                    "The taskset does not match its claimed digest.",
                    category="conflict"
                    if (_scope_key(context.scope), claimed_reference)
                    in self._registrations
                    else "invalid_input",
                )
        reference = f"taskset:{digest.value}"
        previous = self._registrations.get((_scope_key(context.scope), reference))
        if previous is not None and previous[0] != identity:
            raise ConnectorError(
                "taskset_immutable",
                "The taskset digest already identifies different content.",
                category="conflict",
            )
        if previous is not None:
            return previous[1]
        self._holders.append(holder)
        artifact = TasksetArtifact(reference, digest, taskset)
        self._items[(_scope_key(context.scope), reference)] = taskset
        self._registrations[(_scope_key(context.scope), reference)] = (
            identity,
            artifact,
        )
        self._idempotency[retry_key] = identity
        return artifact

    def resolve(self, reference, context):
        _check_context(context)
        taskset = self._items.get((_scope_key(context.scope), reference))
        if taskset is None:
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            )
        registered = self._registrations.get((_scope_key(context.scope), reference))
        return (registered[1] if registered else None) or TasksetArtifact(
            reference,
            ContentDigest("sha256", reference.removeprefix("taskset:")),
            taskset,
        )

    def delete(self, reference, context):
        _check_context(context)
        key = (_scope_key(context.scope), reference)
        existed = key in self._items
        self._items.pop(key, None)
        self._registrations.pop(key, None)
        return existed


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
        self._cancellations = {}
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

    def update(self, job_id, record, *, expected_version, lease, context):
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
        if self._leases.get(key) != lease or lease.expires_at <= time.monotonic():
            raise ConnectorError(
                "job_lease_lost",
                "The active job lease does not authorize this update.",
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
        retry_key = (_scope_key(context.scope), context.idempotency_key)
        request = (job_id, expected_version)
        prior = self._cancellations.get(retry_key)
        if prior is not None:
            if prior[0] != request:
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key was reused with different input.",
                    category="conflict",
                )
            return dict(prior[1])
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
        self._cancellations[retry_key] = (request, cancelled)
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
        self._promotion_idempotency = {}

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
        scope = _scope_key(context.scope)
        retry_key = (scope, context.idempotency_key)
        request = (
            candidate_id,
            expected_generation,
            operation,
            context.owner.kind,
            context.owner.id,
        )
        prior = self._promotion_idempotency.get(retry_key)
        if prior is not None:
            if prior[0] != request:
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key was reused with different input.",
                    category="conflict",
                )
            return prior[1]
        current = self._promotions.get(scope)
        generation = current.generation if current is not None else 0
        if generation != expected_generation:
            raise ConnectorError(
                "promotion_generation_conflict",
                "The promotion generation changed.",
                category="conflict",
            )
        self.get(candidate_id, context)
        promoted = Promotion(
            generation + 1,
            candidate_id,
            current.candidate_id if current is not None else None,
            operation,
            context.owner,
        )
        self._promotions[scope] = promoted
        self._promotion_idempotency[retry_key] = (request, promoted)
        return promoted

    def current(self, context):
        _check_context(context)
        return self._promotions.get(_scope_key(context.scope))

    def delete(self, candidate_id, context):
        _check_context(context)
        key = (_scope_key(context.scope), candidate_id)
        existed = key in self._items
        self._items.pop(key, None)
        return existed


class _MemoryPrivacy:
    def __init__(self):
        self._copies = {}
        self._deletions = {}
        self._retries = {}

    def put_copy(self, record, context):
        _check_context(context)
        key = (_scope_key(context.scope), record["id"])
        existing = self._copies.get(key)
        if existing is not None and existing != record:
            raise ConnectorError(
                "runtime_copy_immutable",
                "The runtime copy ID already identifies different metadata.",
                category="conflict",
            )
        self._copies[key] = dict(record)
        return dict(record)

    def get_copy(self, copy_id, context):
        _check_context(context)
        try:
            return dict(self._copies[(_scope_key(context.scope), copy_id)])
        except KeyError:
            raise ConnectorError(
                "runtime_copy_not_found",
                "The runtime copy was not found.",
                category="not_found",
            ) from None

    def list_copies(self, selectors, *, cursor, limit, context):
        _check_context(context)
        if not selectors or not 1 <= limit <= 100:
            raise ConnectorError(
                "pagination_invalid",
                "Copy pagination is invalid.",
                category="invalid_input",
            )
        values = []
        for (scope, _copy_id), record in sorted(self._copies.items()):
            if scope != _scope_key(context.scope) or (cursor and record["id"] <= cursor):
                continue
            matches = {
                "exportId": record.get("sourceTrainingExportId"),
                "grantId": record.get("permittingGrantIds", ()),
                "evidenceDigest": record.get("evidenceDigests", ()),
                "tasksetDigest": record.get("tasksetDigest"),
            }
            if all(
                value in matches[name]
                if isinstance(matches[name], (list, tuple))
                else matches[name] == value
                for name, value in selectors.items()
            ):
                values.append(dict(record))
        next_cursor = values[limit - 1]["id"] if len(values) > limit else None
        return tuple(values[:limit]), next_cursor

    def tombstone_copy(self, copy_id, *, state, retention, context):
        saved = self.get_copy(copy_id, context)
        saved["useState"] = state
        saved["state"] = state
        if retention is not None:
            saved["retention"] = dict(retention)
        self._copies[(_scope_key(context.scope), copy_id)] = saved
        return dict(saved)

    def create_deletion(self, request, context):
        _check_context(context)
        retry = (_scope_key(context.scope), context.idempotency_key)
        prior = self._retries.get(retry)
        if prior is not None:
            return dict(self._deletions[prior])
        deletion_id = f"deletion_{len(self._deletions) + 1}"
        receipt = {
            "schemaVersion": "replica.runtime-deletion-receipt/v1",
            "id": deletion_id,
            "scope": {
                "tenantId": context.scope.tenant_id,
                "repository": context.scope.repository,
            },
            **dict(request),
            "state": "revoking",
            "createdAt": "2026-11-18T00:00:00Z",
            "updatedAt": "2026-11-18T00:00:00Z",
            "items": [],
            "pendingItems": [],
            "failures": [],
            "version": 1,
        }
        key = (_scope_key(context.scope), deletion_id)
        self._deletions[key] = receipt
        self._retries[retry] = key
        return dict(receipt)

    def get_deletion(self, deletion_id, context):
        _check_context(context)
        try:
            return dict(self._deletions[(_scope_key(context.scope), deletion_id)])
        except KeyError:
            raise ConnectorError(
                "deletion_not_found",
                "The deletion receipt was not found.",
                category="not_found",
            ) from None

    def list_deletions(self, states, context):
        _check_context(context)
        return tuple(
            dict(receipt)
            for (scope, _deletion_id), receipt in self._deletions.items()
            if scope == _scope_key(context.scope) and receipt["state"] in states
        )

    def update_deletion(
        self, deletion_id, record, *, expected_version, context
    ):
        current = self.get_deletion(deletion_id, context)
        if current["version"] != expected_version:
            raise ConnectorError(
                "deletion_version_conflict",
                "The deletion receipt changed.",
                category="conflict",
            )
        saved = dict(record, version=expected_version + 1)
        self._deletions[(_scope_key(context.scope), deletion_id)] = saved
        return dict(saved)


class _MemoryExecution:
    name = "contract"
    production_eligible = True
    supports_hard_credit_budget = True

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
        del taskset, work_directory
        _check_context(context)
        _check_credential(credential, "training", context)
        self.training_contexts.append(context)
        completed = (
            min(max_updates, int(context.max_credits))
            if context.budget_mode == "hard"
            else max_updates
        )
        return TrainingResult(
            adapter_name="adapter.bin",
            adapter=b"adapter",
            baseline_report={"meanReward": 0.5},
            candidate_report={"meanReward": 0.75},
            metadata={"operationId": context.operation_id},
            updates_completed=completed,
            usage=(
                Usage(
                    operation_id=context.operation_id,
                    scope=context.scope,
                    connector=self.name,
                    kind="training_credits",
                    quantity=float(completed),
                    unit="credits",
                    cost=float(completed) / 10,
                    currency="USD",
                    source="contract-connector",
                ),
            ),
        )

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
    def __init__(
        self,
        scope: RuntimeScope = RuntimeScope("tenant-one", "octo/example"),
    ):
        self.scope = scope

    def acquire(self, audience, context):
        _check_context(context)
        if context.scope != self.scope:
            raise ConnectorError(
                "credential_scope_unauthorized",
                "Credentials are unavailable outside this customer scope.",
                category="unauthorized",
            )
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
        self.other_repository_scope = RuntimeScope("tenant-one", "octo/other")
        self.other_tenant_scope = RuntimeScope("tenant-two", "octo/example")
        self.taskset_bundle = _taskset_bundle()
        self._taskset_holder, self.taskset = _materialize_taskset(self.taskset_bundle)
        self.taskset_digest = taskset_digest(self.taskset)
        self.taskset_bundle = replace(
            self.taskset_bundle,
            digest=self.taskset_digest,
        )
        self.taskset_reference = f"taskset:{self.taskset_digest.value}"
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
            privacy=_MemoryPrivacy(),
            training={"contract": self.execution},
            inference={"contract": self.execution},
            credentials=_MemoryCredentials(self.scope),
            observability=self.observability,
        )

    def fixture(self):
        return ConnectorConformanceFixture(
            connectors=self.connectors,
            scope=self.scope,
            other_repository_scope=self.other_repository_scope,
            other_tenant_scope=self.other_tenant_scope,
            taskset_bundle=self.taskset_bundle,
            taskset_digest=self.taskset_digest,
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


class _ResolveOnlyTasksets:
    def __init__(self, delegate):
        self._delegate = delegate

    def resolve(self, reference, context):
        return self._delegate.resolve(reference, context)


class _TrustingTasksetDigest(_MemoryTasksets):
    def __init__(self, scope, reference, taskset):
        super().__init__(
            scope,
            reference,
            taskset,
            trust_claimed_digest=True,
        )


class _UnrelatedTasksetContent(_MemoryTasksets):
    def register(self, bundle, context):
        registered = super().register(bundle, context)
        return replace(
            registered,
            taskset=Taskset(
                Path("."),
                {},
                (),
                {},
                {"train": (), "dev": (), "test": ()},
            ),
        )


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


class _NonExclusiveLeases(_MemoryJobs):
    def acquire(self, job_id, *, ttl_seconds, context):
        self._leases.pop((_scope_key(context.scope), job_id), None)
        return super().acquire(
            job_id,
            ttl_seconds=ttl_seconds,
            context=context,
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
    def update(self, job_id, record, *, expected_version, lease, context):
        key = (_scope_key(context.scope), job_id)
        current = self._jobs.get(key)
        active = self._leases.get(key)
        if current is not None and current.get("state") == "cancelled":
            self._jobs[key] = dict(current, state="queued")
            accepted_lease = replace(lease, expires_at=time.monotonic() + 5)
            self._leases[key] = accepted_lease
            try:
                return super().update(
                    job_id,
                    record,
                    expected_version=expected_version,
                    lease=accepted_lease,
                    context=context,
                )
            finally:
                self._jobs[key] = current
                if active is None:
                    self._leases.pop(key, None)
                else:
                    self._leases[key] = active
        return super().update(
            job_id,
            record,
            expected_version=expected_version,
            lease=lease,
            context=context,
        )


class _UnfencedUpdates(_MemoryJobs):
    def update(self, job_id, record, *, expected_version, lease, context):
        key = (_scope_key(context.scope), job_id)
        active = self._leases.get(key)
        accepted_lease = replace(lease, expires_at=time.monotonic() + 5)
        self._leases[key] = accepted_lease
        try:
            return super().update(
                job_id,
                record,
                expected_version=expected_version,
                lease=accepted_lease,
                context=context,
            )
        finally:
            if active is None:
                self._leases.pop(key, None)
            else:
                self._leases[key] = active


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
        del taskset, work_directory, credential
        return TrainingResult(
            "adapter.bin",
            b"adapter",
            {"meanReward": 0.5},
            {"meanReward": 0.75},
            {"operationId": context.operation_id},
            max_updates,
        )

    def predict(self, adapter, request, *, context, credential):
        del adapter, request, credential
        return {"operationId": context.operation_id}


class _BudgetBlindExecution(_MemoryExecution):
    def train(self, *args, max_updates, context, **kwargs):
        result = super().train(
            *args,
            max_updates=max_updates,
            context=replace(context, max_credits=None, budget_mode="none"),
            **kwargs,
        )
        return replace(
            result,
            usage=(
                replace(
                    result.usage[0],
                    operation_id=context.operation_id,
                    scope=context.scope,
                    quantity=float(max_updates),
                ),
            ),
        )


class _MissingUsageExecution(_MemoryExecution):
    def train(self, *args, **kwargs):
        return replace(super().train(*args, **kwargs), usage=())


class _AlwaysFailingInference(_MemoryExecution):
    def predict(self, adapter, request, *, context, credential):
        del adapter, request, context, credential
        raise ConnectorError(
            "deadline_exceeded",
            "Inference is never available.",
            category="deadline_exceeded",
        )


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


class _CrossScopeCredentials(_MemoryCredentials):
    def acquire(self, audience, context):
        _check_context(context)
        return Credential(
            f"{context.operation_id}:{audience}",
            min(context.deadline, time.monotonic() + 60),
            audience,
            context.scope,
            context.operation_id,
        )


class _WrongScopeCredentials(_MemoryCredentials):
    def acquire(self, audience, context):
        credential = super().acquire(audience, context)
        return replace(
            credential,
            scope=RuntimeScope("another-tenant", context.scope.repository),
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
    def test_package_exports_the_conformance_factory_as_a_callable(self):
        self.assertIs(replica_brand_check.connector_conformance, connector_conformance)
        self.assertTrue(callable(replica_brand_check.connector_conformance))

    def test_contract_only_bundle_passes_the_reusable_conformance_suite(self):
        result, output = self._run_suite(_MemoryBundle)

        self.assertTrue(result.wasSuccessful(), output)
        self.assertGreater(result.testsRun, 0)

    def test_shared_suite_rejects_mutable_unscoped_candidate_storage(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(candidates=_MutableUnscopedCandidates()),
            "candidate storage that overwrites an ID or crosses customer scope",
        )

    def test_shared_suite_requires_taskset_registration(self):
        def bundle():
            result = _MemoryBundle()
            result.connectors = replace(
                result.connectors,
                tasksets=_ResolveOnlyTasksets(result.connectors.tasksets),
            )
            return result

        self._assert_suite_rejects(
            bundle,
            "a taskset connector that can resolve but cannot register a private bundle",
        )

    def test_shared_suite_rejects_tasksets_that_trust_a_claimed_digest(self):
        def bundle():
            result = _MemoryBundle()
            result.connectors = replace(
                result.connectors,
                tasksets=_TrustingTasksetDigest(
                    result.scope,
                    result.taskset_reference,
                    result.taskset,
                ),
            )
            return result

        self._assert_suite_rejects(
            bundle,
            "taskset registration that trusts an incorrect claimed digest",
        )

    def test_shared_suite_rejects_training_that_ignores_a_hard_budget(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(execution=_BudgetBlindExecution()),
            "a training connector that exceeds a hard credit budget",
        )

    def test_shared_suite_rejects_training_without_authoritative_usage(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(execution=_MissingUsageExecution()),
            "a training connector that omits authoritative usage",
        )

    def test_shared_suite_rejects_unrelated_registered_taskset_content(self):
        def bundle():
            result = _MemoryBundle()
            result.connectors = replace(
                result.connectors,
                tasksets=_UnrelatedTasksetContent(
                    result.scope,
                    result.taskset_reference,
                    result.taskset,
                ),
            )
            return result

        self._assert_suite_rejects(
            bundle,
            "taskset registration that returns unrelated manifest, tasks, or image bytes",
        )

    def test_shared_suite_rejects_lease_operations_that_ignore_cancellation(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_CancellationBlindJobs()),
            "lease acquisition or release after cancellation",
        )

    def test_shared_suite_rejects_nonexclusive_job_leases(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_NonExclusiveLeases()),
            "a second worker acquiring an unexpired lease",
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

    def test_shared_suite_rejects_job_updates_without_active_lease_fencing(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(jobs=_UnfencedUpdates()),
            "a stale worker updating a job after its lease was replaced",
        )

    def test_shared_suite_rejects_training_or_inference_that_ignores_context(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(execution=_DeadlineBlindExecution()),
            "training or inference that ignores cancellation and deadlines",
        )

    def test_shared_suite_rejects_inference_that_never_serves_a_live_request(self):
        inference = _AlwaysFailingInference()
        self._assert_suite_rejects(
            lambda: _bundle_with(inference={"contract": inference}),
            "inference that rejects every live request",
        )

    def test_shared_suite_rejects_credentials_that_outlive_the_operation(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(credentials=_UnboundedCredentials()),
            "credentials whose expiry exceeds the operation deadline",
        )

    def test_shared_suite_rejects_credentials_for_another_scope(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(credentials=_WrongScopeCredentials()),
            "credentials issued for another customer scope",
        )

    def test_shared_suite_rejects_credential_acquisition_outside_the_bundle_scope(self):
        self._assert_suite_rejects(
            lambda: _bundle_with(credentials=_CrossScopeCredentials()),
            "credential acquisition outside the bundle scope",
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

    def test_digest_requires_exact_lowercase_sha256_hex(self):
        for value in (
            "0x" + "a" * 62,
            "+" + "a" * 63,
            "a_" + "a" * 62,
            "A" * 64,
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                ContentDigest("sha256", value)

    def test_credential_representation_omits_secret_value(self):
        credential = Credential(
            "secret-value",
            time.monotonic() + 1,
            "training",
            RuntimeScope("tenant", "repo"),
            "operation",
        )

        self.assertNotIn("secret-value", repr(credential))

    def test_promotion_cas_rejects_stale_missing_candidate_before_lookup(self):
        bundle = _MemoryBundle()
        connector = bundle.connectors.candidates
        first = connector.put(
            _candidate("generation-one"),
            _context(bundle.scope, "store-generation-one"),
        )
        promoted = connector.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=_context(bundle.scope, "promote-generation-one"),
        )

        with self.assertRaises(ConnectorError) as stale:
            connector.promote(
                "candidate_missing",
                expected_generation=0,
                operation="promote",
                context=_context(bundle.scope, "stale-missing-candidate"),
            )

        self.assertEqual(stale.exception.code, "promotion_generation_conflict")
        self.assertEqual(
            connector.current(_context(bundle.scope, "current-promotion")),
            promoted,
        )

    def test_budget_context_and_training_result_keep_authoritative_usage(self):
        bundle = _MemoryBundle()
        context = _context(
            bundle.scope,
            "hard-budget-training",
            max_credits=2,
            budget_mode="hard",
        )
        credential = bundle.connectors.credentials.acquire("training", context)
        with TemporaryDirectory() as work:
            result = bundle.execution.train(
                bundle.taskset,
                Path(work),
                max_updates=2,
                context=context,
                credential=credential,
            )

        self.assertEqual(context.max_credits, 2)
        self.assertEqual(context.budget_mode, "hard")
        self.assertEqual(len(result.usage), 1)
        self.assertEqual(
            (
                result.usage[0].quantity,
                result.usage[0].unit,
                result.usage[0].cost,
                result.usage[0].currency,
                result.usage[0].source,
            ),
            (2.0, "credits", 0.2, "USD", "contract-connector"),
        )
        with self.assertRaises(ValueError):
            _context(
                bundle.scope,
                "missing-hard-cap",
                budget_mode="hard",
            )

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
