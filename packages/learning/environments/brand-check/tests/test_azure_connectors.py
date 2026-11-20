"""Contract coverage for the customer-operated Azure connector bundle."""

from __future__ import annotations

import hashlib
import io
import json
import pickle
import tarfile
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import replica_brand_check.azure_connectors as azure_module
from replica_brand_check.azure_connectors import (
    AzureBlobArtifactConnector,
    AzureBlobTasksetConnector,
    AzureContainerAppsTrainingConnector,
    AzureEndpointInferenceConnector,
    AzureManagedIdentityCredentialConnector,
    AzureObservabilityConnector,
    AzurePostgresCandidateConnector,
    AzurePostgresJobConnector,
    _extract_taskset_archive,
    create_azure_connector_bundle,
    initialize_azure_postgres,
)
from replica_brand_check.taskset import MAX_IMAGE_BYTES
from replica_brand_check.connector_conformance import (
    ConnectorConformanceFixture,
    connector_conformance,
)
from replica_brand_check.connectors import (
    Artifact,
    Cancellation,
    Candidate,
    ConnectorError,
    ContentDigest,
    Credential,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
    Usage,
)
from tests.support import make_task, taskset_bundle, write_taskset


_RESOURCES = []


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


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
        owner=RuntimeOwner("worker", "azure-connector-test"),
        deadline=deadline if deadline is not None else time.monotonic() + 30,
        cancellation=cancellation or Cancellation(),
        max_credits=max_credits,
        budget_mode=budget_mode,
    )


def _artifact(data: bytes, **metadata) -> Artifact:
    return Artifact(
        digest=_digest(data),
        media_type="application/octet-stream",
        data=data,
        metadata=metadata,
    )


def _candidate(name: str) -> Candidate:
    artifact = _artifact(name.encode(), name="adapter.bin")
    manifest = {"name": name, "artifact": str(artifact.digest)}
    identity = hashlib.sha256()
    identity.update(
        (
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
        ).encode()
    )
    identity.update(b"\0")
    identity.update(
        (
            json.dumps(
                {
                    "digest": str(artifact.digest),
                    "mediaType": artifact.media_type,
                    "metadata": artifact.metadata,
                },
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode()
    )
    identity.update(b"\0")
    identity.update(artifact.data)
    return Candidate(
        id=f"candidate_{name}",
        digest=ContentDigest("sha256", identity.hexdigest()),
        manifest=manifest,
        artifacts=(artifact,),
    )


class _BlobDownload:
    def __init__(self, value):
        self._value = value

    def readall(self):
        return self._value["data"]

    def chunks(self):
        data = self._value["data"]
        for offset in range(0, len(data), 64 * 1024):
            yield data[offset : offset + 64 * 1024]


class ResourceExistsError(Exception):
    pass


class ResourceNotFoundError(Exception):
    pass


class _BlobService:
    def __init__(self):
        self.blobs = {}
        self.versions = {}
        self.stale_version_names = set()

    def upload_blob(
        self,
        name,
        data,
        *,
        overwrite=False,
        metadata=None,
        **kwargs,
    ):
        del kwargs
        if name in self.blobs and not overwrite:
            raise ResourceExistsError(name)
        if name in self.blobs:
            self.versions.setdefault(name, []).append(
                {
                    "id": f"version-{len(self.versions.get(name, [])) + 1}",
                    **self.blobs[name],
                }
            )
        self.blobs[name] = {
            "data": bytes(data),
            "metadata": dict(metadata or {}),
        }

    def download_blob(self, name):
        try:
            return _BlobDownload(self.blobs[name])
        except KeyError:
            raise ResourceNotFoundError(name) from None

    def list_blob_versions(self, name):
        versions = [version["id"] for version in self.versions.get(name, ())]
        if name in self.stale_version_names:
            versions.insert(0, "already-deleted")
        return tuple(versions)

    def delete_blob(self, name, *, version_id=None, permanent=False):
        if not permanent:
            raise AssertionError("withdrawal deletion must be permanent")
        if version_id is not None:
            versions = self.versions.get(name, [])
            remaining = [
                version for version in versions if version["id"] != version_id
            ]
            if len(remaining) == len(versions):
                raise ResourceNotFoundError(f"{name}?versionid={version_id}")
            self.versions[name] = remaining
            return
        if self.blobs.pop(name, None) is None:
            raise ResourceNotFoundError(name)


class _InterruptedBlobService(_BlobService):
    def __init__(self):
        super().__init__()
        self.fail_descriptor_once = True

    def upload_blob(self, name, data, **kwargs):
        if name.endswith(".json") and self.fail_descriptor_once:
            self.fail_descriptor_once = False
            raise RuntimeError("interrupted descriptor write")
        return super().upload_blob(name, data, **kwargs)


class _Postgres:
    """A transaction-shaped fake for the connector's PostgreSQL state procedures."""

    def __init__(self):
        self.jobs = {}
        self.job_retries = {}
        self.leases = {}
        self.candidates = {}
        self.promotions = {}
        self.promotion_retries = {}
        self.transactions = 0
        self.sql_jobs = {}
        self.sql_candidates = {}
        self.sql_promotions = []
        self.sql_idempotency = {}

    def __call__(self):
        return self

    def cursor(self):
        self.transactions += 1
        return _PostgresCursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass

    @contextmanager
    def transaction(self):
        self.transactions += 1
        yield self

    def create_job(self, scope, job_id, record, idempotency_key):
        retry_key = (scope, idempotency_key)
        signature = (job_id, dict(record))
        existing_retry = self.job_retries.get(retry_key)
        if existing_retry is not None:
            if existing_retry["signature"] != signature:
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key names different job input.",
                    category="conflict",
                )
            return dict(existing_retry["result"])
        key = (scope, job_id)
        if key in self.jobs:
            raise ConnectorError(
                "job_conflict", "The job already exists.", category="conflict"
            )
        result = {**record, "id": job_id, "version": 1}
        self.jobs[key] = result
        self.job_retries[retry_key] = {"signature": signature, "result": result}
        return dict(result)

    def get_job(self, scope, job_id):
        try:
            return dict(self.jobs[(scope, job_id)])
        except KeyError:
            raise ConnectorError(
                "job_not_found", "The job was not found.", category="not_found"
            ) from None

    def list_jobs(self, scope, states):
        return [
            dict(record)
            for (record_scope, _), record in self.jobs.items()
            if record_scope == scope and record["state"] in states
        ]

    def update_job(self, scope, job_id, record, expected_version, lease_token):
        current = self.get_job(scope, job_id)
        lease = self.leases.get((scope, job_id))
        if (
            current["version"] != expected_version
            or lease is None
            or lease["token"] != lease_token
            or lease["expires_at"] <= time.monotonic()
            or current["state"] == "cancelled"
        ):
            raise ConnectorError(
                "job_update_conflict",
                "The job version or lease is stale.",
                category="conflict",
            )
        updated = {**record, "id": job_id, "version": expected_version + 1}
        self.jobs[(scope, job_id)] = updated
        return dict(updated)

    def cancel_job(self, scope, job_id, expected_version, idempotency_key):
        retry_key = (scope, idempotency_key)
        signature = (job_id, expected_version)
        existing_retry = self.job_retries.get(retry_key)
        if existing_retry is not None:
            if existing_retry["signature"] != signature:
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key names different cancellation input.",
                    category="conflict",
                )
            return dict(existing_retry["result"])
        current = self.get_job(scope, job_id)
        if current["version"] != expected_version:
            raise ConnectorError(
                "job_version_conflict",
                "The job version is stale.",
                category="conflict",
            )
        cancelled = {**current, "state": "cancelled", "version": expected_version + 1}
        self.jobs[(scope, job_id)] = cancelled
        self.job_retries[retry_key] = {
            "signature": signature,
            "result": cancelled,
        }
        return dict(cancelled)

    def acquire_lease(self, scope, job_id, owner, ttl_seconds):
        current = self.get_job(scope, job_id)
        if current["state"] == "cancelled":
            raise ConnectorError(
                "job_cancelled", "A cancelled job cannot be leased.", category="conflict"
            )
        key = (scope, job_id)
        current_lease = self.leases.get(key)
        if current_lease is not None and current_lease["expires_at"] > time.monotonic():
            raise ConnectorError(
                "lease_conflict", "The job already has a lease.", category="conflict"
            )
        lease = {
            "token": f"lease-{len(self.leases) + self.transactions}",
            "owner": owner,
            "expires_at": time.monotonic() + ttl_seconds,
        }
        self.leases[key] = lease
        return dict(lease)

    def renew_lease(self, scope, job_id, token, ttl_seconds):
        lease = self.leases.get((scope, job_id))
        if (
            lease is None
            or lease["token"] != token
            or lease["expires_at"] <= time.monotonic()
        ):
            raise ConnectorError(
                "lease_conflict", "The lease is stale.", category="conflict"
            )
        lease = {**lease, "expires_at": time.monotonic() + ttl_seconds}
        self.leases[(scope, job_id)] = lease
        return dict(lease)

    def release_lease(self, scope, job_id, token):
        lease = self.leases.get((scope, job_id))
        if lease is None or lease["token"] != token:
            raise ConnectorError(
                "lease_conflict", "The lease is stale.", category="conflict"
            )
        del self.leases[(scope, job_id)]

    def put_candidate(self, scope, candidate):
        key = (scope, candidate.id)
        existing = self.candidates.get(key)
        if existing is not None and existing != candidate:
            raise ConnectorError(
                "candidate_conflict",
                "The candidate ID names different content.",
                category="conflict",
            )
        self.candidates[key] = candidate
        return candidate

    def get_candidate(self, scope, candidate_id):
        try:
            return self.candidates[(scope, candidate_id)]
        except KeyError:
            raise ConnectorError(
                "candidate_not_found",
                "The candidate was not found.",
                category="not_found",
            ) from None

    def promote_candidate(
        self,
        scope,
        candidate_id,
        expected_generation,
        operation,
        owner,
        idempotency_key,
    ):
        retry_key = (scope, idempotency_key)
        signature = (candidate_id, expected_generation, operation, owner)
        existing_retry = self.promotion_retries.get(retry_key)
        if existing_retry is not None:
            if existing_retry["signature"] != signature:
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key names a different promotion.",
                    category="conflict",
                )
            return existing_retry["result"]
        current = self.promotions.get(scope)
        generation = 0 if current is None else current.generation
        if generation != expected_generation:
            raise ConnectorError(
                "promotion_generation_conflict",
                "The promotion generation is stale.",
                category="conflict",
            )
        self.get_candidate(scope, candidate_id)
        result = SimpleNamespace(
            generation=generation + 1,
            candidate_id=candidate_id,
            previous_candidate_id=None if current is None else current.candidate_id,
            operation=operation,
            owner=owner,
        )
        self.promotions[scope] = result
        self.promotion_retries[retry_key] = {
            "signature": signature,
            "result": result,
        }
        return result

    def current_promotion(self, scope):
        return self.promotions.get(scope)


class _SchemaCursor:
    def __init__(self, statements):
        self.statements = statements

    def execute(self, sql, parameters=()):
        self.statements.append((sql, tuple(parameters)))

    def close(self):
        pass


class _SchemaConnection:
    def __init__(self):
        self.statements = []
        self.committed = False

    def cursor(self):
        return _SchemaCursor(self.statements)

    def commit(self):
        self.committed = True

    def rollback(self):
        pass

    def close(self):
        pass


class _PostgresCursor:
    def __init__(self, database):
        self.database = database
        self.rowcount = 0
        self._one = None
        self._many = []

    def close(self):
        pass

    def fetchone(self):
        value = self._one
        self._one = None
        return value

    def fetchall(self):
        return list(self._many)

    def execute(self, sql, parameters):
        query = " ".join(sql.split())
        self.rowcount = 0
        self._one = None
        self._many = []

        if query.startswith("SELECT pg_advisory_xact_lock("):
            return
        if query.startswith("SELECT request_digest, result FROM replica_decision_runtime.replica_decision_idempotency"):
            scope, key = parameters
            row = self.database.sql_idempotency.get((scope, "cancel", key))
            if row is not None:
                self._one = (row["request_digest"], row["result"])
            return
        if query.startswith("INSERT INTO replica_decision_runtime.replica_decision_idempotency"):
            scope, key, request_digest, result = parameters
            self.database.sql_idempotency[(scope, "cancel", key)] = {
                "request_digest": request_digest,
                "result": result,
            }
            self.rowcount = 1
            return
        if query.startswith("SELECT job_id, create_request_digest"):
            scope, key = parameters
            row = next(
                (
                    value
                    for (row_scope, _), value in self.database.sql_jobs.items()
                    if row_scope == scope and value["create_key"] == key
                ),
                None,
            )
            if row is not None:
                self._one = (
                    row["job_id"],
                    row["create_digest"],
                    row["record"],
                    row["version"],
                )
            return
        if query.startswith("SELECT 1 FROM replica_decision_runtime.replica_decision_jobs"):
            scope, job_id = parameters
            if (scope, job_id) in self.database.sql_jobs:
                self._one = (1,)
            return
        if query.startswith("INSERT INTO replica_decision_runtime.replica_decision_jobs"):
            scope, job_id, record, create_key, create_digest = parameters
            self.database.sql_jobs[(scope, job_id)] = {
                "job_id": job_id,
                "record": record,
                "version": 1,
                "create_key": create_key,
                "create_digest": create_digest,
                "lease_token": None,
                "lease_owner_kind": None,
                "lease_owner_id": None,
                "lease_expires_at": None,
                "cancellation_key": None,
            }
            self.rowcount = 1
            return
        if query.startswith("SELECT record, version FROM replica_decision_runtime.replica_decision_jobs"):
            if "job_id = %s" in query:
                row = self.database.sql_jobs.get(tuple(parameters))
                if row is not None:
                    self._one = (row["record"], row["version"])
            else:
                scope = parameters[0]
                self._many = [
                    (row["record"], row["version"])
                    for (row_scope, _), row in sorted(self.database.sql_jobs.items())
                    if row_scope == scope
                ]
            return
        if (
            query.startswith("UPDATE replica_decision_runtime.replica_decision_jobs SET record = %s::jsonb")
            and "lease_token = %s" in query
        ):
            (
                record,
                scope,
                job_id,
                version,
                token,
                owner_kind,
                owner_id,
            ) = parameters
            now = time.time()
            row = self.database.sql_jobs.get((scope, job_id))
            if (
                row is not None
                and row["version"] == version
                and row["lease_token"] == token
                and row["lease_owner_kind"] == owner_kind
                and row["lease_owner_id"] == owner_id
                and row["lease_expires_at"] > now
                and json.loads(row["record"]).get("state") != "cancelled"
            ):
                row["record"] = record
                row["version"] += 1
                self.rowcount = 1
            return
        if query.startswith("UPDATE replica_decision_runtime.replica_decision_jobs SET lease_token = %s"):
            token, owner_kind, owner_id, ttl_seconds, scope, job_id = parameters
            now = time.time()
            row = self.database.sql_jobs.get((scope, job_id))
            if (
                row is not None
                and json.loads(row["record"]).get("state") != "cancelled"
                and (
                    row["lease_token"] is None
                    or row["lease_expires_at"] <= now
                )
            ):
                row.update(
                    lease_token=token,
                    lease_owner_kind=owner_kind,
                    lease_owner_id=owner_id,
                    lease_expires_at=now + ttl_seconds,
                )
                self.rowcount = 1
            return
        if query.startswith("UPDATE replica_decision_runtime.replica_decision_jobs SET lease_expires_at"):
            ttl_seconds, scope, job_id, token, owner_kind, owner_id = parameters
            now = time.time()
            row = self.database.sql_jobs.get((scope, job_id))
            if (
                row is not None
                and row["lease_token"] == token
                and row["lease_owner_kind"] == owner_kind
                and row["lease_owner_id"] == owner_id
                and row["lease_expires_at"] > now
            ):
                row["lease_expires_at"] = now + ttl_seconds
                self.rowcount = 1
            return
        if query.startswith("UPDATE replica_decision_runtime.replica_decision_jobs SET lease_token = NULL"):
            scope, job_id, token, owner_kind, owner_id = parameters
            now = time.time()
            row = self.database.sql_jobs.get((scope, job_id))
            if (
                row is not None
                and row["lease_token"] == token
                and row["lease_owner_kind"] == owner_kind
                and row["lease_owner_id"] == owner_id
                and row["lease_expires_at"] > now
            ):
                row.update(
                    lease_token=None,
                    lease_owner_kind=None,
                    lease_owner_id=None,
                    lease_expires_at=None,
                )
                self.rowcount = 1
            return
        if query.startswith("SELECT record, version, cancellation_idempotency_key"):
            row = self.database.sql_jobs.get(tuple(parameters))
            if row is not None:
                self._one = (
                    row["record"],
                    row["version"],
                    row["cancellation_key"],
                )
            return
        if "cancellation_idempotency_key = %s" in query:
            record, key, scope, job_id, version = parameters
            row = self.database.sql_jobs.get((scope, job_id))
            if row is not None and row["version"] == version:
                row["record"] = record
                row["version"] += 1
                row["cancellation_key"] = key
                self.rowcount = 1
            return
        if query.startswith("SELECT digest, descriptor FROM replica_decision_runtime.replica_decision_candidates"):
            row = self.database.sql_candidates.get(tuple(parameters))
            if row is not None:
                self._one = (row["digest"], row["descriptor"])
            return
        if query.startswith("INSERT INTO replica_decision_runtime.replica_decision_candidates"):
            scope, candidate_id, digest, descriptor = parameters
            self.database.sql_candidates[(scope, candidate_id)] = {
                "digest": digest,
                "descriptor": descriptor,
            }
            self.rowcount = 1
            return
        if query.startswith("SELECT descriptor FROM replica_decision_runtime.replica_decision_candidates"):
            row = self.database.sql_candidates.get(tuple(parameters))
            if row is not None:
                self._one = (row["descriptor"],)
            return
        if "WHERE scope_key = %s AND idempotency_key = %s" in query:
            scope, key = parameters
            row = next(
                (
                    value
                    for value in self.database.sql_promotions
                    if value["scope"] == scope and value["idempotency_key"] == key
                ),
                None,
            )
            if row is not None:
                self._one = self._promotion_row(row)
            return
        if (
            query.startswith("SELECT generation, candidate_id")
            and "ORDER BY generation DESC" in query
            and "previous_candidate_id" not in query
        ):
            scope = parameters[0]
            rows = [
                row for row in self.database.sql_promotions if row["scope"] == scope
            ]
            if rows:
                current = max(rows, key=lambda row: row["generation"])
                self._one = (current["generation"], current["candidate_id"])
            return
        if query.startswith("SELECT 1 FROM replica_decision_runtime.replica_decision_candidates"):
            self._one = (
                (1,)
                if tuple(parameters) in self.database.sql_candidates
                else None
            )
            return
        if query.startswith("INSERT INTO replica_decision_runtime.replica_decision_promotions"):
            (
                scope,
                generation,
                candidate_id,
                previous,
                operation,
                owner_kind,
                owner_id,
                idempotency_key,
                request_digest,
            ) = parameters
            self.database.sql_promotions.append(
                {
                    "scope": scope,
                    "generation": generation,
                    "candidate_id": candidate_id,
                    "previous": previous,
                    "operation": operation,
                    "owner_kind": owner_kind,
                    "owner_id": owner_id,
                    "idempotency_key": idempotency_key,
                    "request_digest": request_digest,
                }
            )
            self.rowcount = 1
            return
        if (
            query.startswith("SELECT generation, candidate_id, previous_candidate_id")
            and "ORDER BY generation DESC" in query
        ):
            scope = parameters[0]
            rows = [
                row for row in self.database.sql_promotions if row["scope"] == scope
            ]
            if rows:
                self._one = self._promotion_row(
                    max(rows, key=lambda row: row["generation"])
                )
            return
        raise AssertionError(f"Unexpected SQL: {query}")

    @staticmethod
    def _promotion_row(row):
        return (
            row["generation"],
            row["candidate_id"],
            row["previous"],
            row["operation"],
            row["owner_kind"],
            row["owner_id"],
            row["request_digest"],
        )


class _TrainingClient:
    def __init__(
        self,
        cancellation=None,
        fail_after_cancellation=False,
        cancel_failures=0,
        reported_credits=None,
    ):
        self.requests = []
        self.cancelled = []
        self.status_tokens = []
        self.cancel_tokens = []
        self._cancellation = cancellation
        self._fail_after_cancellation = fail_after_cancellation
        self._cancel_failures = cancel_failures
        self._reported_credits = reported_credits
        self._polls = 0

    def start(self, job_name, request, *, bearer_token):
        self.requests.append(
            {"jobName": job_name, "payload": request, "bearerToken": bearer_token}
        )
        return {"executionId": "training-1"}

    def status(self, job_id, *, bearer_token):
        del job_id
        self.status_tokens.append(bearer_token)
        self._polls += 1
        if self._cancellation is not None and self._polls == 1:
            self._cancellation.cancel()
            if self._fail_after_cancellation:
                raise RuntimeError("status connection closed")
            return {"state": "running"}
        return {
            "state": "succeeded",
            "result": {
                "adapterName": "adapter.bin",
                "adapterBase64": "YWRhcHRlcg==",
                "baselineReport": {"meanReward": 0.5},
                "candidateReport": {"meanReward": 0.75},
                "metadata": {"scaleToZero": True},
                "updatesCompleted": self.requests[-1]["payload"]["limits"][
                    "maxUpdates"
                ],
                "usage": [
                    {
                        "kind": "gpu_seconds",
                        "quantity": 12,
                        "unit": "seconds",
                        "cost": 1.25,
                        "currency": "USD",
                    },
                    {
                        "kind": "training_credits",
                        "quantity": (
                            self._reported_credits
                            if self._reported_credits is not None
                            else min(
                                self.requests[-1]["payload"]["limits"]["maxUpdates"],
                                self.requests[-1]["payload"]["limits"]["maxCredits"]
                                or self.requests[-1]["payload"]["limits"]["maxUpdates"],
                            )
                        ),
                        "unit": "credits",
                        "cost": 0,
                        "currency": "USD",
                    },
                ],
            },
        }

    def cancel(self, job_id, *, bearer_token):
        self.cancel_tokens.append(bearer_token)
        self.cancelled.append(job_id)
        if self._cancel_failures > 0:
            self._cancel_failures -= 1
            raise RuntimeError("cancel unavailable")


class _StatusFailingTrainingClient(_TrainingClient):
    def status(self, job_id, *, bearer_token):
        del job_id, bearer_token
        raise RuntimeError("status unavailable")


class _MalformedStatusTrainingClient(_TrainingClient):
    def status(self, job_id, *, bearer_token):
        del job_id, bearer_token
        return []


class _UnknownStatusTrainingClient(_TrainingClient):
    def status(self, job_id, *, bearer_token):
        del job_id, bearer_token
        return {"state": "mystery"}


class _InferenceClient:
    def __init__(self, readiness):
        self.readiness_value = readiness
        self.requests = []
        self.retries = {}

    def readiness(self, *, bearer_token):
        del bearer_token
        return dict(self.readiness_value)

    def predict(self, request, *, bearer_token):
        key = request["idempotencyKey"]
        previous = self.retries.get(key)
        if previous is not None and previous != request["requestDigest"]:
            raise ConnectorError(
                "idempotency_conflict",
                "The inference idempotency key was reused with different input.",
                category="conflict",
            )
        self.retries[key] = request["requestDigest"]
        self.requests.append({"request": request, "bearerToken": bearer_token})
        answers = (
            {"learning-one": {"yes": 0.8, "no": 0.2}}
            if request.get("questions")
            else {"operationId": request["operationId"]}
        )
        return {
            "answers": answers,
            "candidateId": "candidate_live",
            "generation": request["expectedGeneration"],
            "operationId": request.get("operationId"),
        }


class _IdentityClient:
    def __init__(self, expires_at):
        self.expires_at = expires_at
        self.audiences = []
        self.lock = threading.Lock()

    def get_token(self, audience):
        self.audiences.append(audience)
        return SimpleNamespace(token="short-lived-token", expires_on=self.expires_at)


class _IdentityFactory:
    def __init__(self, expires_at):
        self.expires_at = expires_at

    def __call__(self):
        return _IdentityClient(self.expires_at)


class _TelemetrySink:
    def __init__(self):
        self.records = []

    def emit(self, name, attributes):
        self.records.append((name, attributes))


class _FailingTelemetrySink:
    def emit(self, name, attributes):
        del name, attributes
        raise RuntimeError("telemetry unavailable")


class AzureBlobArtifactConnectorTest(unittest.TestCase):
    def test_scopes_digest_keys_and_refuses_immutable_content_replacement(self):
        blobs = _BlobService()
        retention = []
        first_scope = RuntimeScope("tenant-one", "github/acme/repo")
        second_scope = RuntimeScope("tenant-one", "github/acme/other")
        first = AzureBlobArtifactConnector(
            blobs,
            first_scope,
            retention_hook=lambda name, metadata: retention.append((name, metadata)),
        )
        second = AzureBlobArtifactConnector(
            blobs,
            second_scope,
            retention_hook=lambda name, metadata: retention.append((name, metadata)),
        )
        artifact = _artifact(b"private report", retention_class="training")

        self.assertEqual(first.put(artifact, _context(first_scope, "put-one")), artifact)
        self.assertEqual(second.put(artifact, _context(second_scope, "put-two")), artifact)
        self.assertEqual(len(blobs.blobs), 4)
        self.assertEqual(
            first.get(artifact.digest, _context(first_scope, "get-one")),
            artifact,
        )
        with self.assertRaises(ConnectorError) as changed:
            first.put(
                Artifact(
                    digest=artifact.digest,
                    media_type=artifact.media_type,
                    data=b"replacement",
                    metadata=artifact.metadata,
                ),
                _context(first_scope, "replace"),
            )
        self.assertEqual(changed.exception.category, "integrity")
        self.assertEqual(len(retention), 2)
        primary_keys = [key for key in blobs.blobs if not key.endswith(".json")]
        self.assertEqual(len(primary_keys), 2)
        self.assertNotEqual(*primary_keys)

    def test_retry_repairs_metadata_after_an_interrupted_artifact_write(self):
        blobs = _InterruptedBlobService()
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        connector = AzureBlobArtifactConnector(blobs, scope)
        artifact = _artifact(b"candidate report", kind="candidate-report")

        with self.assertRaises(ConnectorError) as interrupted:
            connector.put(artifact, _context(scope, "interrupted-put"))
        self.assertEqual(interrupted.exception.category, "unavailable")
        self.assertEqual(len(blobs.blobs), 1)

        recovered = connector.put(artifact, _context(scope, "retry-put"))

        self.assertEqual(recovered, artifact)
        self.assertEqual(
            connector.get(artifact.digest, _context(scope, "read-recovered")),
            artifact,
        )
        self.assertEqual(len(blobs.blobs), 2)

    def test_retry_reapplies_retention_after_a_hook_failure(self):
        blobs = _BlobService()
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        attempts = []

        def retention(name, metadata):
            attempts.append((name, metadata))
            if len(attempts) == 1:
                raise RuntimeError("retention service unavailable")

        connector = AzureBlobArtifactConnector(
            blobs,
            scope,
            retention_hook=retention,
        )
        artifact = _artifact(b"retained report", kind="candidate-report")
        with self.assertRaises(ConnectorError) as failed:
            connector.put(artifact, _context(scope, "retention-failed"))
        self.assertEqual(failed.exception.code, "retention_hook_failed")

        self.assertEqual(
            connector.put(artifact, _context(scope, "retention-retry")),
            artifact,
        )
        self.assertEqual(len(attempts), 2)

    def test_withdrawal_deletes_current_blobs_and_every_version(self):
        blobs = _BlobService()
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        connector = AzureBlobArtifactConnector(blobs, scope)
        artifact = _artifact(b"withdrawn report", kind="candidate-report")
        connector.put(artifact, _context(scope, "put-withdrawn"))
        names = tuple(blobs.blobs)
        for name in names:
            blobs.upload_blob(
                name,
                blobs.blobs[name]["data"],
                overwrite=True,
                metadata=blobs.blobs[name]["metadata"],
            )
        self.assertTrue(any(blobs.versions.values()))

        connector.delete(artifact.digest, _context(scope, "delete-withdrawn"))

        self.assertFalse(blobs.blobs)
        self.assertFalse(any(blobs.versions.values()))

    def test_withdrawal_continues_after_a_stale_version_listing(self):
        blobs = _BlobService()
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        connector = AzureBlobArtifactConnector(blobs, scope)
        artifact = _artifact(b"withdrawn report", kind="candidate-report")
        connector.put(artifact, _context(scope, "put-stale-version"))
        for name in tuple(blobs.blobs):
            blobs.upload_blob(
                name,
                blobs.blobs[name]["data"],
                overwrite=True,
                metadata=blobs.blobs[name]["metadata"],
            )
            blobs.stale_version_names.add(name)

        connector.delete(artifact.digest, _context(scope, "delete-stale-version"))

        self.assertFalse(blobs.blobs)
        self.assertFalse(any(blobs.versions.values()))


class AzureBlobTasksetConnectorTest(unittest.TestCase):
    def test_conflicting_retry_does_not_persist_the_losing_taskset(self):
        first_directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        second_directory = write_taskset(
            self,
            [
                make_task(3, answer=False),
                make_task(4, split="test", answer=False),
            ],
        )
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        blobs = _BlobService()
        connector = AzureBlobTasksetConnector(blobs, scope)
        self.addCleanup(connector.close)
        retry_context = _context(
            scope,
            "taskset-winner",
            idempotency_key="shared-taskset-request",
        )
        connector.register(taskset_bundle(first_directory), retry_context)
        winner_blobs = dict(blobs.blobs)

        with self.assertRaises(ConnectorError) as losing_request:
            connector.register(taskset_bundle(second_directory), retry_context)

        self.assertEqual(losing_request.exception.code, "idempotency_conflict")
        self.assertEqual(blobs.blobs, winner_blobs)

    def test_concurrent_resolution_atomically_publishes_one_cache(self):
        directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        blobs = _BlobService()
        writer = AzureBlobTasksetConnector(blobs, scope)
        registered = writer.register(
            taskset_bundle(directory),
            _context(scope, "register-concurrent"),
        )
        writer.close()
        connector = AzureBlobTasksetConnector(blobs, scope)
        self.addCleanup(connector.close)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = tuple(
                executor.map(
                    lambda operation: connector.resolve(
                        registered.reference,
                        _context(scope, operation),
                    ),
                    ("resolve-one", "resolve-two"),
                )
            )

        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0].reference, registered.reference)
        self.assertEqual(results[0].digest, registered.digest)

    def test_archive_extraction_rejects_an_oversized_image_before_writing(self):
        archive_bytes = io.BytesIO()
        with tarfile.open(fileobj=archive_bytes, mode="w") as archive:
            data = b"x" * (MAX_IMAGE_BYTES + 1)
            member = tarfile.TarInfo("images/large.png")
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
        archive_bytes.seek(0)

        with tempfile.TemporaryDirectory() as directory:
            with tarfile.open(fileobj=archive_bytes, mode="r") as archive:
                with self.assertRaises(tarfile.TarError):
                    _extract_taskset_archive(archive, Path(directory))
            self.assertEqual(list(Path(directory).rglob("*")), [])

    def test_resolution_rejects_an_oversized_blob_while_streaming_download(self):
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        blobs = _BlobService()
        connector = AzureBlobTasksetConnector(blobs, scope)
        self.addCleanup(connector.close)
        digest = ContentDigest("sha256", "a" * 64)
        blobs.upload_blob(connector._name(digest), b"x" * 11)

        with mock.patch.object(azure_module, "_MAX_TASKSET_ARCHIVE_BYTES", 10):
            with self.assertRaises(ConnectorError) as oversized:
                connector.resolve(
                    f"taskset:{digest.value}",
                    _context(scope, "resolve-oversized"),
                )

        self.assertEqual(oversized.exception.code, "azure_blob_oversized")

    def test_registration_rejects_oversized_content_before_persisting_any_blob(self):
        directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        blobs = _BlobService()
        connector = AzureBlobTasksetConnector(blobs, scope)
        self.addCleanup(connector.close)

        with mock.patch.object(azure_module, "_MAX_TASKSET_EXPANDED_BYTES", 10):
            with self.assertRaises(ConnectorError) as oversized:
                connector.register(
                    taskset_bundle(directory),
                    _context(scope, "register-oversized"),
                )

        self.assertEqual(oversized.exception.code, "taskset_too_large")
        self.assertFalse(blobs.blobs)

    def test_registration_rejects_an_oversized_archive_before_persistence(self):
        directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        scope = RuntimeScope("tenant-one", "github/acme/repo")
        blobs = _BlobService()
        connector = AzureBlobTasksetConnector(blobs, scope)
        self.addCleanup(connector.close)

        with mock.patch.object(azure_module, "_MAX_TASKSET_ARCHIVE_BYTES", 10):
            with self.assertRaises(ConnectorError) as oversized:
                connector.register(
                    taskset_bundle(directory),
                    _context(scope, "register-archive-oversized"),
                )

        self.assertEqual(oversized.exception.code, "taskset_archive_too_large")
        self.assertFalse(blobs.blobs)


class AzurePostgresConnectorTest(unittest.TestCase):
    def setUp(self):
        self.scope = RuntimeScope("tenant-one", "github/acme/repo")
        self.database = _Postgres()

    def test_initialization_isolates_tables_in_a_dedicated_schema_and_role(self):
        connection = _SchemaConnection()

        initialize_azure_postgres(
            lambda: connection,
            runtime_role="customer_decision_runtime",
        )

        sql = "\n".join(statement for statement, _ in connection.statements)
        self.assertIn("CREATE SCHEMA IF NOT EXISTS replica_decision_runtime", sql)
        self.assertIn(
            "REVOKE ALL ON SCHEMA replica_decision_runtime FROM PUBLIC",
            sql,
        )
        self.assertIn(
            'GRANT USAGE ON SCHEMA replica_decision_runtime TO "customer_decision_runtime"',
            sql,
        )
        self.assertNotIn("replica_runtime", sql)
        self.assertTrue(connection.committed)

    def test_job_transactions_preserve_idempotency_cas_lease_and_cancellation(self):
        jobs = AzurePostgresJobConnector(self.database, self.scope)
        create_context = _context(
            self.scope, "create-job", idempotency_key="stable-job"
        )
        created = jobs.create("job_one", {"state": "queued"}, create_context)
        self.assertEqual(
            jobs.create("job_one", {"state": "queued"}, create_context),
            created,
        )
        with self.assertRaises(ConnectorError) as reused:
            jobs.create(
                "job_two",
                {"state": "queued"},
                _context(self.scope, "create-other", idempotency_key="stable-job"),
            )
        self.assertEqual(reused.exception.category, "conflict")

        lease = jobs.acquire(
            "job_one",
            ttl_seconds=10,
            context=_context(self.scope, "lease"),
        )
        running = jobs.update(
            "job_one",
            {"state": "running"},
            expected_version=created["version"],
            lease=lease,
            context=_context(self.scope, "run"),
        )
        self.assertEqual(
            jobs.create("job_one", {"state": "queued"}, create_context),
            created,
        )
        with self.assertRaises(ConnectorError) as stale:
            jobs.update(
                "job_one",
                {"state": "succeeded"},
                expected_version=created["version"],
                lease=lease,
                context=_context(self.scope, "stale"),
            )
        self.assertEqual(stale.exception.category, "conflict")

        cancel_context = _context(
            self.scope, "cancel", idempotency_key="stable-cancel"
        )
        cancelled = jobs.cancel(
            "job_one",
            expected_version=running["version"],
            context=cancel_context,
        )
        self.assertEqual(cancelled["state"], "cancelled")
        self.assertEqual(
            jobs.cancel(
                "job_one",
                expected_version=running["version"],
                context=cancel_context,
            ),
            cancelled,
        )
        with self.assertRaises(ConnectorError) as changed_version:
            jobs.cancel(
                "job_one",
                expected_version=cancelled["version"],
                context=cancel_context,
            )
        self.assertEqual(changed_version.exception.code, "idempotency_conflict")
        second_job = jobs.create(
            "job_two",
            {"state": "queued"},
            _context(self.scope, "create-job-two"),
        )
        with self.assertRaises(ConnectorError) as changed_job:
            jobs.cancel(
                "job_two",
                expected_version=second_job["version"],
                context=cancel_context,
            )
        self.assertEqual(changed_job.exception.code, "idempotency_conflict")
        with self.assertRaises(ConnectorError):
            jobs.update(
                "job_one",
                {"state": "succeeded"},
                expected_version=cancelled["version"],
                lease=lease,
                context=_context(self.scope, "advance-cancelled"),
            )
        self.assertGreaterEqual(self.database.transactions, 6)

    def test_candidate_promotion_is_generation_checked_and_exactly_retryable(self):
        candidates = AzurePostgresCandidateConnector(
            self.database,
            AzureBlobArtifactConnector(_BlobService(), self.scope),
            self.scope,
        )
        first = candidates.put(
            _candidate("one"), _context(self.scope, "candidate-one")
        )
        second = candidates.put(
            _candidate("two"), _context(self.scope, "candidate-two")
        )
        promote_context = _context(
            self.scope, "promote-one", idempotency_key="promote-one"
        )
        promoted = candidates.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=promote_context,
        )
        self.assertEqual(promoted.generation, 1)
        self.assertEqual(
            candidates.promote(
                first.id,
                expected_generation=0,
                operation="promote",
                context=promote_context,
            ),
            promoted,
        )
        with self.assertRaises(ConnectorError) as stale:
            candidates.promote(
                second.id,
                expected_generation=0,
                operation="promote",
                context=_context(self.scope, "stale-promotion"),
            )
        self.assertEqual(stale.exception.code, "promotion_generation_conflict")
        self.assertEqual(candidates.current(_context(self.scope, "current")), promoted)
        first_path = candidates.artifact_path(
            first.id,
            "adapter.bin",
            _context(self.scope, "materialize-one"),
        )
        second_path = candidates.artifact_path(
            first.id,
            "adapter.bin",
            _context(self.scope, "materialize-two"),
        )
        self.assertEqual(first_path, second_path)
        self.assertEqual(first_path.read_bytes(), b"one")
        cache_root = candidates._cache_root
        with self.assertRaises(ConnectorError) as unsafe:
            candidates.artifact_path(
                first.id,
                "../adapter.bin",
                _context(self.scope, "materialize-unsafe"),
            )
        self.assertEqual(unsafe.exception.code, "candidate_artifact_name_invalid")
        candidates.close()
        self.assertFalse(cache_root.exists())


class AzureExecutionConnectorTest(unittest.TestCase):
    def setUp(self):
        self.scope = RuntimeScope("tenant-one", "github/acme/repo")

    def test_training_propagates_bounds_and_uses_authoritative_azure_usage(self):
        client = _TrainingClient()
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
        )
        context = _context(
            self.scope,
            "train",
            deadline=time.monotonic() + 15,
            max_credits=7,
            budget_mode="hard",
        )
        credential = Credential(
            "training-token",
            context.deadline,
            "training",
            self.scope,
            context.operation_id,
        )

        result = connector.train(
            SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
            Path("unused-work-directory"),
            max_updates=3,
            context=context,
            credential=credential,
        )

        request = client.requests[0]
        self.assertEqual(request["jobName"], "replica-training")
        self.assertEqual(request["payload"]["limits"]["maxUpdates"], 3)
        self.assertEqual(request["payload"]["limits"]["maxCredits"], 7)
        self.assertEqual(request["payload"]["limits"]["budgetMode"], "hard")
        self.assertGreater(request["payload"]["limits"]["deadlineEpoch"], time.time())
        self.assertEqual(result.updates_completed, 3)
        self.assertEqual(result.usage[0].source, "azure")
        self.assertEqual(result.usage[0].cost, 1.25)
        self.assertEqual(result.usage[0].currency, "USD")

    def test_training_returns_authoritative_usage_above_the_budget(self):
        client = _TrainingClient(reported_credits=8)
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
        )
        context = _context(
            self.scope,
            "over-budget-usage",
            max_credits=7,
            budget_mode="hard",
        )

        result = connector.train(
            SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
            Path("unused-work-directory"),
            max_updates=3,
            context=context,
            credential=None,
        )

        self.assertEqual(
            next(item.quantity for item in result.usage if item.kind == "training_credits"),
            8,
        )

    def test_training_refreshes_short_lived_credentials_before_polling(self):
        client = _TrainingClient()
        refreshed = []
        context = _context(
            self.scope,
            "refresh-training-token",
            deadline=time.monotonic() + 300,
            max_credits=7,
            budget_mode="hard",
        )
        initial = Credential(
            "initial-token",
            time.monotonic() + 1,
            "training",
            self.scope,
            context.operation_id,
        )

        def refresh(selected):
            credential = Credential(
                f"refreshed-{len(refreshed) + 1}",
                time.monotonic() + 120,
                "training",
                selected.scope,
                selected.operation_id,
            )
            refreshed.append(credential)
            return credential

        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
            credential_refresh=refresh,
        )

        connector.train(
            SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
            Path("unused-work-directory"),
            max_updates=3,
            context=context,
            credential=initial,
        )

        self.assertEqual(client.requests[0]["bearerToken"], "refreshed-1")
        self.assertEqual(client.status_tokens, ["refreshed-1"])
        self.assertEqual(len(refreshed), 1)

    def test_expired_cleanup_credential_refreshes_after_the_operation_deadline(self):
        context = _context(
            self.scope,
            "refresh-after-deadline",
            deadline=time.monotonic() - 10,
            max_credits=7,
            budget_mode="hard",
        )
        expired = Credential(
            "expired-token",
            time.monotonic() - 5,
            "training",
            self.scope,
            context.operation_id,
        )
        refreshed = []

        def refresh(selected):
            credential = Credential(
                "cleanup-token",
                time.monotonic() + 120,
                "training",
                selected.scope,
                selected.operation_id,
            )
            refreshed.append(credential)
            return credential

        connector = AzureContainerAppsTrainingConnector(
            _TrainingClient(),
            "replica-training",
            cancellation_recovery_hook=lambda *_: None,
            credential_refresh=refresh,
        )

        selected = connector._credential(context, expired)

        self.assertEqual(selected.value, "cleanup-token")
        self.assertEqual(len(refreshed), 1)

    def test_unsupported_hard_budget_uses_provider_neutral_error_code(self):
        connector = AzureContainerAppsTrainingConnector(
            _TrainingClient(),
            "replica-training",
            supports_hard_credit_budget=False,
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
        )
        context = _context(
            self.scope,
            "unsupported-budget",
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as unsupported:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(unsupported.exception.code, "hard_budget_unsupported")

    def test_training_cancellation_cancels_the_remote_job(self):
        cancellation = Cancellation()
        client = _TrainingClient(cancellation)
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
        )
        context = _context(
            self.scope,
            "cancel-training",
            cancellation=cancellation,
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as cancelled:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(cancelled.exception.category, "cancelled")
        self.assertEqual(client.cancelled, ["training-1"])

    def test_failed_status_poll_still_cancels_after_context_cancellation(self):
        cancellation = Cancellation()
        client = _TrainingClient(cancellation, fail_after_cancellation=True)
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: None,
        )
        context = _context(
            self.scope,
            "cancel-failed-poll",
            cancellation=cancellation,
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as cancelled:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(cancelled.exception.category, "cancelled")
        self.assertEqual(client.cancelled, ["training-1"])

    def test_failed_remote_cancellation_is_durably_scheduled(self):
        cancellation = Cancellation()
        client = _TrainingClient(cancellation, cancel_failures=3)
        scheduled = []
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda execution_id, context: scheduled.append(
                (execution_id, context.operation_id)
            ),
        )
        context = _context(
            self.scope,
            "schedule-cancel-recovery",
            cancellation=cancellation,
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as cancelled:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(cancelled.exception.category, "cancelled")
        self.assertEqual(client.cancelled, ["training-1"] * 3)
        self.assertEqual(
            scheduled,
            [("training-1", context.operation_id)],
        )

    def test_status_failure_schedules_recovery_before_abandoning_execution(self):
        client = _StatusFailingTrainingClient()
        scheduled = []
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda execution_id, context: scheduled.append(
                (execution_id, context.operation_id)
            ),
        )
        context = _context(
            self.scope,
            "status-failure-recovery",
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as unavailable:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(unavailable.exception.code, "azure_training_unavailable")
        self.assertEqual(client.cancelled, ["training-1"])
        self.assertEqual(scheduled, [("training-1", context.operation_id)])

    def test_malformed_status_schedules_cancellation_before_integrity_failure(self):
        client = _MalformedStatusTrainingClient()
        scheduled = []
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda execution_id, context: scheduled.append(
                (execution_id, context.operation_id)
            ),
        )
        context = _context(
            self.scope,
            "malformed-status",
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as invalid:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(invalid.exception.code, "azure_training_response_invalid")
        self.assertEqual(client.cancelled, ["training-1"])
        self.assertEqual(scheduled, [("training-1", context.operation_id)])

    def test_unknown_status_cancels_without_polling_until_the_deadline(self):
        client = _UnknownStatusTrainingClient()
        scheduled = []
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda execution_id, context: scheduled.append(
                (execution_id, context.operation_id)
            ),
        )
        context = _context(
            self.scope,
            "unknown-status",
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as invalid:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(invalid.exception.code, "azure_training_response_invalid")
        self.assertEqual(client.cancelled, ["training-1"])
        self.assertEqual(scheduled, [("training-1", context.operation_id)])

    def test_direct_cancellation_still_runs_when_recovery_scheduling_fails(self):
        cancellation = Cancellation()
        client = _TrainingClient(cancellation)
        connector = AzureContainerAppsTrainingConnector(
            client,
            "replica-training",
            poll_interval_seconds=0,
            sleep=lambda _: None,
            cancellation_recovery_hook=lambda *_: (_ for _ in ()).throw(
                RuntimeError("queue unavailable")
            ),
        )
        context = _context(
            self.scope,
            "cancel-without-recovery-queue",
            cancellation=cancellation,
            max_credits=7,
            budget_mode="hard",
        )

        with self.assertRaises(ConnectorError) as cancelled:
            connector.train(
                SimpleNamespace(metadata={"digest": "taskset-one"}, tasks=()),
                Path("unused-work-directory"),
                max_updates=3,
                context=context,
                credential=None,
            )

        self.assertEqual(cancelled.exception.category, "cancelled")
        self.assertEqual(client.cancelled, ["training-1"])

    def test_inference_checks_generation_and_reports_cold_start_readiness(self):
        client = _InferenceClient(
            {
                "state": "starting",
                "coldStart": True,
                "generation": 4,
                "retryAfterSeconds": 8,
            }
        )
        connector = AzureEndpointInferenceConnector(
            client,
            endpoint_name="replica-inference",
            expected_generation=4,
        )
        context = _context(self.scope, "predict")
        credential = Credential(
            "inference-token",
            context.deadline,
            "inference",
            self.scope,
            context.operation_id,
        )

        with self.assertRaises(ConnectorError) as cold:
            connector.predict(
                Path("candidate_live"),
                {"expectedGeneration": 4, "questions": {}},
                context=context,
                credential=credential,
            )
        self.assertEqual(cold.exception.code, "inference_cold_start")
        self.assertTrue(cold.exception.retryable)
        self.assertFalse(client.requests)

        client.readiness_value = {
            "state": "ready",
            "coldStart": False,
            "generation": 5,
        }
        with self.assertRaises(ConnectorError) as stale:
            connector.predict(
                Path("candidate_live"),
                {"expectedGeneration": 4, "questions": {}},
                context=context,
                credential=credential,
            )
        self.assertEqual(stale.exception.code, "inference_generation_conflict")
        self.assertFalse(client.requests)

        client.readiness_value["generation"] = 4
        response = connector.predict(
            Path("candidate_live"),
            {"expectedGeneration": 4, "questions": {"learning-one": {"type": "noul"}}},
            context=context,
            credential=credential,
        )
        self.assertEqual(response["learning-one"], {"yes": 0.8, "no": 0.2})
        self.assertNotIn("operationId", response)
        self.assertEqual(len(client.requests), 1)
        self.assertNotIn("training", client.requests[0]["request"])
        self.assertNotIn("admin", client.requests[0]["request"])
        self.assertEqual(
            client.requests[0]["request"]["idempotencyKey"],
            "sha256:"
            + hashlib.sha256(
                (
                    hashlib.sha256(
                        f"{self.scope.tenant_id}\0{self.scope.repository}".encode()
                    ).hexdigest()
                    + "\0"
                    + context.idempotency_key
                ).encode()
            ).hexdigest(),
        )
        self.assertEqual(
            client.requests[0]["request"]["operationId"],
            context.operation_id,
        )
        self.assertRegex(
            client.requests[0]["request"]["requestDigest"],
            r"^sha256:[a-f0-9]{64}$",
        )
        with self.assertRaises(ConnectorError) as conflict:
            connector.predict(
                Path("candidate_live"),
                {
                    "expectedGeneration": 4,
                    "questions": {"another-learning": {"type": "noul"}},
                },
                context=context,
                credential=credential,
            )
        self.assertEqual(conflict.exception.code, "idempotency_conflict")

        with self.assertRaises(ConnectorError) as missing:
            connector.predict(
                Path("candidate_live"),
                {"questions": {}},
                context=context,
                credential=credential,
            )
        self.assertEqual(missing.exception.code, "expected_generation_required")

    def test_inference_refuses_a_training_scoped_credential(self):
        client = _InferenceClient(
            {"state": "ready", "coldStart": False, "generation": 4}
        )
        connector = AzureEndpointInferenceConnector(
            client,
            endpoint_name="replica-inference",
            expected_generation=4,
        )
        context = _context(self.scope, "predict-with-training-token")
        training_credential = Credential(
            "training-token",
            context.deadline,
            "training",
            self.scope,
            context.operation_id,
        )

        with self.assertRaises(ConnectorError) as refused:
            connector.predict(
                Path("candidate_live"),
                {"expectedGeneration": 4, "questions": {}},
                context=context,
                credential=training_credential,
            )

        self.assertEqual(refused.exception.category, "unauthorized")
        self.assertFalse(client.requests)


class AzureIdentityAndObservabilityConnectorTest(unittest.TestCase):
    def setUp(self):
        self.scope = RuntimeScope("tenant-one", "github/acme/repo")

    def test_managed_identity_credential_is_deadline_bounded_and_not_retained(self):
        deadline = time.monotonic() + 20
        identity = _IdentityClient(expires_at=time.time() + 600)
        connector = AzureManagedIdentityCredentialConnector(
            identity,
            self.scope,
            allowed_audiences=("https://replica-inference.azure.com/.default",),
        )

        credential = connector.acquire(
            "https://replica-inference.azure.com/.default",
            _context(self.scope, "credential", deadline=deadline),
        )

        self.assertEqual(credential.value, "short-lived-token")
        self.assertLessEqual(credential.expires_at, deadline)
        self.assertEqual(
            identity.audiences,
            ["https://replica-inference.azure.com/.default"],
        )
        self.assertNotIn(
            "short-lived-token",
            repr(vars(connector)),
            "The connector must not retain a durable copy of an acquired token.",
        )

    def test_telemetry_emits_only_allowlisted_operational_fields(self):
        sink = _TelemetrySink()
        connector = AzureObservabilityConnector(sink, self.scope)
        context = _context(self.scope, "usage")
        usage = Usage(
            operation_id=context.operation_id,
            scope=self.scope,
            connector="azure-training",
            kind="gpu_seconds",
            quantity=12,
            unit="seconds",
            cost=1.25,
            currency="USD",
            source="azure",
            metadata={
                "azure.region": "westus3",
                "azure.execution_id": "training-1",
                "screenshot": "raw-image-data",
                "prompt": "private prompt",
                "learnings": ["private learning"],
                "credential": "secret-token",
            },
        )

        connector.record(usage, context)

        self.assertEqual(len(sink.records), 1)
        event_name, record = sink.records[0]
        self.assertEqual(event_name, "replica.decision.usage")
        self.assertEqual(record["operation_id"], context.operation_id)
        self.assertNotIn(self.scope.tenant_id, repr(record))
        self.assertNotIn(self.scope.repository, repr(record))
        self.assertEqual(record["azure.region"], "westus3")
        self.assertEqual(record["azure.execution_id"], "training-1")
        serialized = repr(record)
        for secret in (
            "raw-image-data",
            "private prompt",
            "private learning",
            "secret-token",
        ):
            self.assertNotIn(secret, serialized)

    def test_telemetry_rejects_free_form_usage_fields_before_emitting(self):
        sink = _TelemetrySink()
        connector = AzureObservabilityConnector(sink, self.scope)
        context = _context(self.scope, "invalid-usage")
        for label, kind, unit, currency in (
            ("kind", "raw_prompt_bytes", "bytes", None),
            ("unit", "storage_bytes", "screenshots", None),
            ("currency", "gpu_seconds", "seconds", "usd"),
        ):
            with self.subTest(field=label):
                usage = Usage(
                    operation_id=context.operation_id,
                    scope=self.scope,
                    connector="azure-training",
                    kind=kind,
                    quantity=1,
                    unit=unit,
                    cost=1 if currency is not None else None,
                    currency=currency,
                    source="azure",
                )
                with self.assertRaises(ConnectorError) as refused:
                    connector.record(usage, context)
                self.assertEqual(refused.exception.category, "invalid_input")
        self.assertFalse(sink.records)

    def test_telemetry_sink_failures_use_the_connector_error_contract(self):
        connector = AzureObservabilityConnector(
            _FailingTelemetrySink(),
            self.scope,
        )
        context = _context(self.scope, "failed-telemetry")
        usage = Usage(
            operation_id=context.operation_id,
            scope=self.scope,
            connector="azure-training",
            kind="gpu_seconds",
            quantity=1,
            unit="seconds",
        )

        with self.assertRaises(ConnectorError) as usage_error:
            connector.record(usage, context)
        self.assertEqual(usage_error.exception.code, "azure_observability_unavailable")
        self.assertTrue(usage_error.exception.retryable)

        with self.assertRaises(ConnectorError) as operation_error:
            connector.record_operation("training", "failed", context)
        self.assertEqual(
            operation_error.exception.code,
            "azure_observability_unavailable",
        )


class _CleanupSuite(unittest.TestSuite):
    def run(self, result, debug=False):
        try:
            return super().run(result, debug)
        finally:
            while _RESOURCES:
                _RESOURCES.pop().doCleanups()


def _conformance_fixture():
    case = unittest.TestCase()
    directory = write_taskset(
        case,
        [
            make_task(1, answer=True),
            make_task(2, split="test", answer=True),
        ],
    )
    scope = RuntimeScope("tenant-one", "github/acme/repo")
    other_repository_scope = RuntimeScope("tenant-one", "github/acme/other")
    other_tenant_scope = RuntimeScope("tenant-two", "github/acme/repo")
    blobs = _BlobService()
    database = _Postgres()
    training_client = _TrainingClient()
    training = AzureContainerAppsTrainingConnector(
        training_client,
        "replica-training",
        poll_interval_seconds=0,
        sleep=lambda _: None,
        cancellation_recovery_hook=lambda *_: None,
    )
    inference_client = _InferenceClient(
        {"state": "ready", "coldStart": False, "generation": 1}
    )
    inference = AzureEndpointInferenceConnector(
        inference_client,
        endpoint_name="replica-inference",
        expected_generation=1,
    )
    identity = _IdentityClient(expires_at=time.time() + 600)
    telemetry = _TelemetrySink()
    azure = create_azure_connector_bundle(
        scope=scope,
        blob_container=blobs,
        connection_factory=database,
        training={training.name: training},
        inference={training.name: inference},
        token_provider=identity,
        training_token_provider_factory=_IdentityFactory(time.time() + 600),
        credential_audiences=("training", "inference"),
        telemetry_sink=telemetry,
    )
    case.assertIsNotNone(training.credential_refresh)
    pickle.dumps(training.credential_refresh)
    bundle = taskset_bundle(directory)
    registered = azure.connectors.tasksets.register(
        bundle,
        _context(scope, "azure-conformance-register"),
    )

    def usage():
        return tuple(
            Usage(
                operation_id=attributes["operation_id"],
                scope=scope,
                connector=attributes["connector"],
                kind=attributes["kind"],
                quantity=attributes["quantity"],
                unit=attributes["unit"],
                cost=attributes["cost"],
                currency=attributes["currency"],
                source=attributes["source"],
            )
            for _, attributes in telemetry.records
        )

    _RESOURCES.append(case)
    return ConnectorConformanceFixture(
        connectors=azure.connectors,
        scope=scope,
        other_repository_scope=other_repository_scope,
        other_tenant_scope=other_tenant_scope,
        taskset_bundle=bundle,
        taskset_digest=registered.digest,
        taskset_reference=registered.reference,
        usage=usage,
    )


def load_tests(loader, tests, pattern):
    del loader, pattern
    tests.addTests(connector_conformance("azure-reference", _conformance_fixture))
    return _CleanupSuite(tests)


if __name__ == "__main__":
    unittest.main()
