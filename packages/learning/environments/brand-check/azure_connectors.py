"""Customer-operated Azure connectors for the Replica decision runtime."""

from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import math
import os
import re
import shutil
import tarfile
import tempfile
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping, Protocol, Sequence

from .connectors import (
    Artifact,
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
    TrainingResult,
    Usage,
    check_context,
)
from .local_connectors import (
    _candidate_content_digest,
    _digest,
    _json_bytes,
    _materialize_taskset_bundle,
    taskset_digest,
)
from .taskset import TasksetError, load_taskset


class AzureBlobContainer(Protocol):
    """The subset of an Azure Blob container client used by this bundle."""

    def upload_blob(
        self,
        name: str,
        data: bytes,
        *,
        overwrite: bool = False,
        metadata: Mapping[str, str] | None = None,
    ) -> Any: ...

    def download_blob(self, name: str) -> Any: ...

    def list_blob_versions(self, name: str) -> Sequence[str]: ...

    def delete_blob(
        self,
        name: str,
        *,
        version_id: str | None = None,
        permanent: bool = False,
    ) -> Any: ...


class AzureTokenProvider(Protocol):
    """A workload identity or managed identity token source."""

    def get_token(self, audience: str) -> Any: ...


class AzureJobTransport(Protocol):
    """A replaceable Azure Container Apps Jobs or Azure ML adapter."""

    def start(
        self,
        job_name: str,
        payload: Mapping[str, Any],
        *,
        bearer_token: str | None,
    ) -> Mapping[str, Any]: ...

    def status(
        self,
        execution_id: str,
        *,
        bearer_token: str | None,
    ) -> Mapping[str, Any]: ...

    def cancel(
        self,
        execution_id: str,
        *,
        bearer_token: str | None,
    ) -> None: ...


class AzureEndpointTransport(Protocol):
    """A customer inference endpoint adapter with no training or administration methods."""

    def readiness(self, *, bearer_token: str | None) -> Mapping[str, Any]: ...

    def predict(
        self,
        request: Mapping[str, Any],
        *,
        bearer_token: str | None,
    ) -> Mapping[str, Any]: ...


class AzureTelemetrySink(Protocol):
    """A Pino/OpenTelemetry bridge owned by the embedding service."""

    def emit(self, name: str, attributes: Mapping[str, Any]) -> None: ...


RetentionHook = Callable[[str, Mapping[str, str]], None]
ConnectionFactory = Callable[[], Any]

_TERMINAL_JOB_STATES = {"succeeded", "failed", "cancelled"}
_SAFE_USAGE_METADATA = {
    "azure.execution_id",
    "azure.job_name",
    "azure.region",
    "azure.resource_id",
    "azure.sku",
    "cold_start",
    "promotion_generation",
    "provider_status",
}
_USAGE_KINDS = {
    "cpu_seconds",
    "credits",
    "gpu_seconds",
    "inference_seconds",
    "input_tokens",
    "network_bytes",
    "output_tokens",
    "requests",
    "storage_bytes",
    "training_credits",
    "training_seconds",
}
_USAGE_UNITS = {"bytes", "credits", "requests", "seconds", "tokens"}
_CURRENCY = re.compile(r"^[A-Z]{3}$")


def _scope_key(scope: RuntimeScope) -> str:
    return hashlib.sha256(
        f"{scope.tenant_id}\0{scope.repository}".encode("utf-8")
    ).hexdigest()


def _scope_prefix(scope: RuntimeScope) -> str:
    repository = "".join(
        member if member.isalnum() or member in ".-_" else "-"
        for member in scope.repository.lower()
    ).strip("-")
    return f"repositories/{repository[:96] or 'repository'}-{_scope_key(scope)[:16]}"


def _request_digest(value: Any) -> str:
    return str(_digest(_json_bytes(value)))


def _json_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _json_value(member) for key, member in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_value(member) for member in value]
    return value


def _download_bytes(container: AzureBlobContainer, name: str) -> bytes:
    try:
        response = container.download_blob(name)
        if hasattr(response, "readall"):
            data = response.readall()
        elif isinstance(response, bytes):
            data = response
        else:
            data = response.read()
    except Exception as error:
        if _is_missing(error):
            raise ConnectorError(
                "azure_blob_not_found",
                "The private Azure Blob was not found.",
                category="not_found",
            ) from None
        raise ConnectorError(
            "azure_blob_unavailable",
            "Azure Blob Storage is unavailable.",
            category="unavailable",
            retryable=True,
        ) from error
    if not isinstance(data, bytes):
        raise ConnectorError(
            "azure_blob_invalid",
            "Azure Blob Storage returned invalid content.",
            category="integrity",
        )
    return data


def _is_missing(error: Exception) -> bool:
    return (
        getattr(error, "status_code", None) == 404
        or error.__class__.__name__ in {"ResourceNotFoundError", "BlobNotFound"}
    )


def _is_exists(error: Exception) -> bool:
    return (
        getattr(error, "status_code", None) in (409, 412)
        or error.__class__.__name__
        in {"ResourceExistsError", "ResourceModifiedError", "BlobAlreadyExists"}
    )


class _AzureScopedConnector:
    def __init__(self, scope: RuntimeScope):
        self.scope = scope
        self.scope_key = _scope_key(scope)
        self.prefix = _scope_prefix(scope)

    def _check(self, context: OperationContext, *, hide: bool = False) -> None:
        check_context(context)
        if context.scope != self.scope:
            raise ConnectorError(
                "scoped_record_not_found" if hide else "scope_unauthorized",
                "The requested record was not found."
                if hide
                else "The operation scope does not match this Azure connector bundle.",
                category="not_found" if hide else "unauthorized",
            )


class AzureBlobArtifactConnector(_AzureScopedConnector):
    """Private, repository-scoped, immutable Azure Blob artifacts."""

    def __init__(
        self,
        container: AzureBlobContainer,
        scope: RuntimeScope,
        *,
        retention_hook: RetentionHook | None = None,
    ):
        super().__init__(scope)
        self.container = container
        self.retention_hook = retention_hook

    def put(self, artifact: Artifact, context: OperationContext) -> Artifact:
        self._check(context)
        if _digest(artifact.data) != artifact.digest:
            raise ConnectorError(
                "artifact_digest_mismatch",
                "The artifact bytes do not match the claimed digest.",
                category="integrity",
            )
        name = self._name(artifact.digest)
        metadata = {
            "digest": artifact.digest.value,
            "media_type_sha256": hashlib.sha256(
                artifact.media_type.encode("utf-8")
            ).hexdigest(),
            "repository_scope": self.scope_key,
        }
        descriptor = _json_bytes(
            {
                "digest": str(artifact.digest),
                "mediaType": artifact.media_type,
                "metadata": artifact.metadata,
            }
        )
        try:
            self.container.upload_blob(
                name,
                artifact.data,
                overwrite=False,
                metadata=metadata,
            )
        except Exception as error:
            if not _is_exists(error):
                raise ConnectorError(
                    "azure_blob_unavailable",
                    "Azure Blob Storage is unavailable.",
                    category="unavailable",
                    retryable=True,
                ) from error
            existing_data = _download_bytes(self.container, name)
            if _digest(existing_data) != artifact.digest or existing_data != artifact.data:
                raise ConnectorError(
                    "artifact_immutable",
                    "The artifact digest already identifies different content.",
                    category="integrity",
                )
            try:
                existing = self.get(artifact.digest, context)
            except ConnectorError as stored_error:
                if stored_error.category != "not_found":
                    raise
                try:
                    self.container.upload_blob(
                        f"{name}.json",
                        descriptor,
                        overwrite=False,
                        metadata={"repository_scope": self.scope_key},
                    )
                except Exception as descriptor_error:
                    if not _is_exists(descriptor_error):
                        raise ConnectorError(
                            "azure_blob_unavailable",
                            "Azure Blob Storage is unavailable.",
                            category="unavailable",
                            retryable=True,
                        ) from descriptor_error
                existing = self.get(artifact.digest, context)
            if existing != artifact:
                raise ConnectorError(
                    "artifact_immutable",
                    "The artifact digest already identifies different content.",
                    category="integrity",
                )
            return existing
        try:
            self.container.upload_blob(
                f"{name}.json",
                descriptor,
                overwrite=False,
                metadata={"repository_scope": self.scope_key},
            )
        except Exception as error:
            if _is_exists(error):
                existing = self.get(artifact.digest, context)
                if existing == artifact:
                    return existing
                raise ConnectorError(
                    "artifact_immutable",
                    "The artifact digest already identifies different content.",
                    category="integrity",
                ) from None
            raise ConnectorError(
                "azure_blob_unavailable",
                "Azure Blob Storage is unavailable.",
                category="unavailable",
                retryable=True,
            ) from error
        if self.retention_hook is not None:
            self.retention_hook(name, metadata)
        return artifact

    def get(self, digest: ContentDigest, context: OperationContext) -> Artifact:
        self._check(context, hide=True)
        name = self._name(digest)
        data = _download_bytes(self.container, name)
        descriptor_bytes = _download_bytes(self.container, f"{name}.json")
        try:
            descriptor = json.loads(descriptor_bytes)
            artifact = Artifact(
                digest,
                descriptor["mediaType"],
                data,
                descriptor.get("metadata", {}),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            raise ConnectorError(
                "artifact_damaged",
                "The stored artifact descriptor is invalid.",
                category="integrity",
            ) from None
        if descriptor.get("digest") != str(digest) or _digest(data) != digest:
            raise ConnectorError(
                "artifact_damaged",
                "The stored artifact no longer matches its immutable identity.",
                category="integrity",
            )
        return artifact

    def delete(self, digest: ContentDigest, context: OperationContext) -> None:
        """Permanently remove every Blob version for an authorized withdrawal."""
        self._check(context)
        name = self._name(digest)
        for target in (name, f"{name}.json"):
            try:
                versions = tuple(self.container.list_blob_versions(target))
            except Exception as error:
                if _is_missing(error):
                    versions = ()
                else:
                    raise ConnectorError(
                        "azure_blob_unavailable",
                        "Azure Blob Storage is unavailable.",
                        category="unavailable",
                        retryable=True,
                    ) from error
            for version_id in versions:
                check_context(context)
                try:
                    self.container.delete_blob(
                        target,
                        version_id=version_id,
                        permanent=True,
                    )
                except Exception as error:
                    if not _is_missing(error):
                        raise ConnectorError(
                            "azure_blob_unavailable",
                            "Azure Blob Storage is unavailable.",
                            category="unavailable",
                            retryable=True,
                        ) from error
            try:
                self.container.delete_blob(target, permanent=True)
            except Exception as error:
                if not _is_missing(error):
                    raise ConnectorError(
                        "azure_blob_unavailable",
                        "Azure Blob Storage is unavailable.",
                        category="unavailable",
                        retryable=True,
                    ) from error

    def _name(self, digest: ContentDigest) -> str:
        return (
            f"{self.prefix}/artifacts/{digest.algorithm}/"
            f"{digest.value[:2]}/{digest.value}"
        )


class AzureBlobTasksetConnector(_AzureScopedConnector):
    """Private immutable tasksets archived in repository-scoped Blob paths."""

    def __init__(
        self,
        container: AzureBlobContainer,
        scope: RuntimeScope,
        *,
        retention_hook: RetentionHook | None = None,
    ):
        super().__init__(scope)
        self.container = container
        self.retention_hook = retention_hook
        self._cache_root = Path(tempfile.mkdtemp(prefix="replica-azure-tasksets-"))

    def close(self) -> None:
        shutil.rmtree(self._cache_root, ignore_errors=True)

    def __del__(self) -> None:
        self.close()

    def register(
        self, bundle: TasksetBundle, context: OperationContext
    ) -> TasksetArtifact:
        self._check(context)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _materialize_taskset_bundle(root, bundle, context)
            try:
                taskset = load_taskset(root)
            except TasksetError as error:
                raise ConnectorError(
                    "taskset_invalid",
                    str(error),
                    category="invalid_input",
                ) from None
            digest = taskset_digest(taskset)
            if bundle.digest is not None and bundle.digest != digest:
                try:
                    _download_bytes(self.container, self._name(bundle.digest))
                except ConnectorError as error:
                    if error.category != "not_found":
                        raise
                else:
                    raise ConnectorError(
                        "taskset_immutable",
                        "The taskset digest already identifies different content.",
                        category="conflict",
                    )
                raise ConnectorError(
                    "taskset_digest_mismatch",
                    "The taskset does not match the claimed digest.",
                    category="invalid_input",
                )
            archive = self._archive(root)
        request_digest = _request_digest(
            {
                "claimedDigest": str(bundle.digest) if bundle.digest else None,
                "archiveDigest": str(_digest(archive)),
                "scope": self.scope_key,
            }
        )
        idempotency_name = (
            f"{self.prefix}/tasksets/.idempotency/"
            f"{hashlib.sha256(context.idempotency_key.encode()).hexdigest()}.json"
        )
        retry_record = _json_bytes(
            {
                "requestDigest": request_digest,
                "reference": f"taskset:{digest.value}",
            }
        )
        try:
            self.container.upload_blob(
                idempotency_name,
                retry_record,
                overwrite=False,
                metadata={"repository_scope": self.scope_key},
            )
        except Exception as error:
            if not _is_exists(error):
                raise ConnectorError(
                    "azure_blob_unavailable",
                    "Azure Blob Storage is unavailable.",
                    category="unavailable",
                    retryable=True,
                ) from error
            try:
                retry = json.loads(_download_bytes(self.container, idempotency_name))
            except (TypeError, json.JSONDecodeError):
                raise ConnectorError(
                    "taskset_idempotency_damaged",
                    "The taskset retry record is invalid.",
                    category="integrity",
                ) from None
            if not isinstance(retry, dict):
                raise ConnectorError(
                    "taskset_idempotency_damaged",
                    "The taskset retry record is invalid.",
                    category="integrity",
                )
            if (
                retry.get("requestDigest") != request_digest
                or retry.get("reference") != f"taskset:{digest.value}"
            ):
                raise ConnectorError(
                    "idempotency_conflict",
                    "The idempotency key was reused with different input.",
                    category="conflict",
                )
        name = self._name(digest)
        metadata = {
            "digest": digest.value,
            "repository_scope": self.scope_key,
            "kind": "decision-taskset",
        }
        try:
            self.container.upload_blob(
                name,
                archive,
                overwrite=False,
                metadata=metadata,
            )
        except Exception as error:
            if not _is_exists(error):
                raise ConnectorError(
                    "azure_blob_unavailable",
                    "Azure Blob Storage is unavailable.",
                    category="unavailable",
                    retryable=True,
                ) from error
            existing = _download_bytes(self.container, name)
            if existing != archive:
                raise ConnectorError(
                    "taskset_immutable",
                    "The taskset digest already identifies different content.",
                    category="conflict",
                )
        if self.retention_hook is not None:
            self.retention_hook(name, metadata)
        return self.resolve(f"taskset:{digest.value}", context)

    def resolve(self, reference: str, context: OperationContext) -> TasksetArtifact:
        self._check(context, hide=True)
        try:
            digest = ContentDigest("sha256", reference.removeprefix("taskset:"))
        except ValueError:
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            ) from None
        if reference != f"taskset:{digest.value}":
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            )
        root = self._cache_root / digest.value
        if not root.is_dir():
            archive = _download_bytes(self.container, self._name(digest))
            staging = self._cache_root / f".{digest.value}.{uuid.uuid4().hex}"
            staging.mkdir(mode=0o700)
            try:
                with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
                    _extract_taskset_archive(source, staging)
                staged_taskset = load_taskset(staging)
                if taskset_digest(staged_taskset) != digest:
                    raise TasksetError(
                        "The stored taskset no longer matches its immutable identity."
                    )
                try:
                    staging.rename(root)
                except OSError:
                    if not root.is_dir():
                        raise
            except (tarfile.TarError, TasksetError, OSError):
                raise ConnectorError(
                    "taskset_damaged",
                    "The stored taskset is invalid.",
                    category="integrity",
                ) from None
            finally:
                shutil.rmtree(staging, ignore_errors=True)
        try:
            taskset = load_taskset(root)
        except TasksetError:
            raise ConnectorError(
                "taskset_damaged",
                "The stored taskset is invalid.",
                category="integrity",
            ) from None
        if taskset_digest(taskset) != digest:
            raise ConnectorError(
                "taskset_damaged",
                "The stored taskset no longer matches its immutable identity.",
                category="integrity",
            )
        return TasksetArtifact(reference, digest, taskset)

    def _archive(self, root: Path) -> bytes:
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w") as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    data = path.read_bytes()
                    member = tarfile.TarInfo(str(path.relative_to(root)))
                    member.size = len(data)
                    member.mode = 0o400
                    member.mtime = 0
                    member.uid = 0
                    member.gid = 0
                    member.uname = ""
                    member.gname = ""
                    archive.addfile(member, io.BytesIO(data))
        return gzip.compress(tar_buffer.getvalue(), mtime=0)

    def _name(self, digest: ContentDigest) -> str:
        return f"{self.prefix}/tasksets/{digest.value}/bundle.tar.gz"


class _AzurePostgresConnector(_AzureScopedConnector):
    def __init__(self, connection_factory: ConnectionFactory, scope: RuntimeScope):
        super().__init__(scope)
        self.connection_factory = connection_factory

    @contextmanager
    def _transaction(self) -> Iterator[Any]:
        connection = self.connection_factory()
        cursor = connection.cursor()
        try:
            yield cursor
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            cursor.close()
            connection.close()

    def _execute(self, cursor: Any, sql: str, parameters: Sequence[Any]) -> Any:
        cursor.execute(sql, tuple(parameters))
        return cursor


AZURE_POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS replica_decision_jobs (
  scope_key text NOT NULL,
  job_id text NOT NULL,
  version bigint NOT NULL,
  record jsonb NOT NULL,
  create_idempotency_key text NOT NULL,
  create_request_digest text NOT NULL,
  lease_token text,
  lease_owner_kind text,
  lease_owner_id text,
  lease_expires_at double precision,
  cancellation_idempotency_key text,
  PRIMARY KEY (scope_key, job_id),
  UNIQUE (scope_key, create_idempotency_key)
);
CREATE TABLE IF NOT EXISTS replica_decision_candidates (
  scope_key text NOT NULL,
  candidate_id text NOT NULL,
  digest text NOT NULL,
  descriptor jsonb NOT NULL,
  PRIMARY KEY (scope_key, candidate_id)
);
CREATE TABLE IF NOT EXISTS replica_decision_promotions (
  scope_key text NOT NULL,
  generation bigint NOT NULL,
  candidate_id text NOT NULL,
  previous_candidate_id text,
  operation text NOT NULL,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  PRIMARY KEY (scope_key, generation),
  UNIQUE (scope_key, idempotency_key)
);
CREATE TABLE IF NOT EXISTS replica_decision_idempotency (
  scope_key text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (scope_key, operation, idempotency_key)
);
""".strip()


def initialize_azure_postgres(connection_factory: ConnectionFactory) -> None:
    """Install the decision-runtime tables in the existing Replica PostgreSQL database."""
    connection = connection_factory()
    cursor = connection.cursor()
    try:
        for statement in AZURE_POSTGRES_SCHEMA.split(";"):
            if statement.strip():
                cursor.execute(statement)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
        connection.close()


class AzurePostgresJobConnector(_AzurePostgresConnector):
    """Durable PostgreSQL CAS, cancellation, idempotency, and lease state."""

    def create(
        self, job_id: str, record: Mapping[str, Any], context: OperationContext
    ) -> Mapping[str, Any]:
        self._check(context)
        request_digest = _request_digest(
            {"jobId": job_id, "record": record, "scope": self.scope_key}
        )
        saved = dict(_json_value(record), version=1)
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (
                        "replica-decision-create:"
                        f"{self.scope_key}:{context.idempotency_key}",
                    ),
                )
                self._execute(
                    cursor,
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"replica-decision-job:{self.scope_key}:{job_id}",),
                )
                self._execute(
                    cursor,
                    """
                    SELECT job_id, create_request_digest, record, version
                    FROM replica_decision_jobs
                    WHERE scope_key = %s AND create_idempotency_key = %s
                    FOR UPDATE
                    """,
                    (self.scope_key, context.idempotency_key),
                )
                retry = cursor.fetchone()
                if retry is not None:
                    if retry[0] != job_id or retry[1] != request_digest:
                        raise ConnectorError(
                            "idempotency_conflict",
                            "The idempotency key was reused with different input.",
                            category="conflict",
                        )
                    return dict(_loaded_json(retry[2]), version=retry[3])
                self._execute(
                    cursor,
                    """
                    SELECT 1 FROM replica_decision_jobs
                    WHERE scope_key = %s AND job_id = %s
                    """,
                    (self.scope_key, job_id),
                )
                if cursor.fetchone() is not None:
                    raise ConnectorError(
                        "job_exists",
                        "The job already exists.",
                        category="conflict",
                    )
                self._execute(
                    cursor,
                    """
                    INSERT INTO replica_decision_jobs
                      (scope_key, job_id, version, record,
                       create_idempotency_key, create_request_digest)
                    VALUES (%s, %s, 1, %s::jsonb, %s, %s)
                    """,
                    (
                        self.scope_key,
                        job_id,
                        json.dumps(_json_value(record)),
                        context.idempotency_key,
                        request_digest,
                    ),
                )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return saved

    def get(self, job_id: str, context: OperationContext) -> Mapping[str, Any]:
        self._check(context, hide=True)
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    SELECT record, version FROM replica_decision_jobs
                    WHERE scope_key = %s AND job_id = %s
                    """,
                    (self.scope_key, job_id),
                )
                row = cursor.fetchone()
        except Exception as error:
            raise _database_error(error) from error
        if row is None:
            raise ConnectorError(
                "job_not_found",
                "The job was not found.",
                category="not_found",
            )
        return dict(_loaded_json(row[0]), version=row[1])

    def list(
        self, states: Sequence[str], context: OperationContext
    ) -> Sequence[Mapping[str, Any]]:
        check_context(context)
        if context.scope != self.scope:
            return ()
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    SELECT record, version FROM replica_decision_jobs
                    WHERE scope_key = %s
                    ORDER BY job_id
                    """,
                    (self.scope_key,),
                )
                rows = cursor.fetchall()
        except Exception as error:
            raise _database_error(error) from error
        selected = set(states)
        return tuple(
            dict(_loaded_json(record), version=version)
            for record, version in rows
            if _loaded_json(record).get("state") in selected
        )

    def update(
        self,
        job_id: str,
        record: Mapping[str, Any],
        *,
        expected_version: int,
        lease: JobLease,
        context: OperationContext,
    ) -> Mapping[str, Any]:
        self._check(context)
        now = time.time()
        saved = dict(_json_value(record), version=expected_version + 1)
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    UPDATE replica_decision_jobs
                    SET record = %s::jsonb, version = version + 1
                    WHERE scope_key = %s AND job_id = %s AND version = %s
                      AND lease_token = %s AND lease_owner_kind = %s
                      AND lease_owner_id = %s AND lease_expires_at > %s
                      AND COALESCE(record->>'state', '') <> 'cancelled'
                    """,
                    (
                        json.dumps(_json_value(record)),
                        self.scope_key,
                        job_id,
                        expected_version,
                        lease.token,
                        lease.owner.kind,
                        lease.owner.id,
                        now,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ConnectorError(
                        "job_version_or_lease_conflict",
                        "The job version or active worker lease changed.",
                        category="conflict",
                    )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return saved

    def acquire(
        self, job_id: str, *, ttl_seconds: float, context: OperationContext
    ) -> JobLease:
        self._check(context)
        _check_ttl(ttl_seconds)
        token = uuid.uuid4().hex
        now_epoch = time.time()
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    UPDATE replica_decision_jobs
                    SET lease_token = %s, lease_owner_kind = %s, lease_owner_id = %s,
                        lease_expires_at = %s
                    WHERE scope_key = %s AND job_id = %s
                      AND COALESCE(record->>'state', '') <> 'cancelled'
                      AND (lease_token IS NULL OR lease_expires_at <= %s)
                    """,
                    (
                        token,
                        context.owner.kind,
                        context.owner.id,
                        now_epoch + ttl_seconds,
                        self.scope_key,
                        job_id,
                        now_epoch,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ConnectorError(
                        "job_lease_conflict",
                        "Another worker holds the job lease.",
                        category="conflict",
                    )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return JobLease(
            job_id,
            token,
            context.owner,
            time.monotonic() + ttl_seconds,
        )

    def renew(
        self, lease: JobLease, *, ttl_seconds: float, context: OperationContext
    ) -> JobLease:
        self._check(context)
        _check_ttl(ttl_seconds)
        now_epoch = time.time()
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    UPDATE replica_decision_jobs
                    SET lease_expires_at = %s
                    WHERE scope_key = %s AND job_id = %s AND lease_token = %s
                      AND lease_owner_kind = %s AND lease_owner_id = %s
                      AND lease_expires_at > %s
                    """,
                    (
                        now_epoch + ttl_seconds,
                        self.scope_key,
                        lease.job_id,
                        lease.token,
                        lease.owner.kind,
                        lease.owner.id,
                        now_epoch,
                    ),
                )
                if cursor.rowcount != 1:
                    raise ConnectorError(
                        "job_lease_lost",
                        "The job lease is no longer owned by this worker.",
                        category="conflict",
                    )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return JobLease(
            lease.job_id,
            lease.token,
            lease.owner,
            time.monotonic() + ttl_seconds,
        )

    def release(self, lease: JobLease, context: OperationContext) -> None:
        self._check(context)
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    UPDATE replica_decision_jobs
                    SET lease_token = NULL, lease_owner_kind = NULL,
                        lease_owner_id = NULL, lease_expires_at = NULL
                    WHERE scope_key = %s AND job_id = %s AND lease_token = %s
                      AND lease_owner_kind = %s AND lease_owner_id = %s
                      AND lease_expires_at > %s
                    """,
                    (
                        self.scope_key,
                        lease.job_id,
                        lease.token,
                        lease.owner.kind,
                        lease.owner.id,
                        time.time(),
                    ),
                )
                if cursor.rowcount != 1:
                    raise ConnectorError(
                        "job_lease_lost",
                        "The job lease is no longer owned by this worker.",
                        category="conflict",
                    )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error

    def cancel(
        self,
        job_id: str,
        *,
        expected_version: int,
        context: OperationContext,
    ) -> Mapping[str, Any]:
        self._check(context)
        request_digest = _request_digest(
            {
                "jobId": job_id,
                "expectedVersion": expected_version,
                "scope": self.scope_key,
            }
        )
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (
                        "replica-decision-cancel:"
                        f"{self.scope_key}:{context.idempotency_key}",
                    ),
                )
                self._execute(
                    cursor,
                    """
                    SELECT request_digest, result
                    FROM replica_decision_idempotency
                    WHERE scope_key = %s AND operation = 'cancel'
                      AND idempotency_key = %s
                    """,
                    (self.scope_key, context.idempotency_key),
                )
                retry = cursor.fetchone()
                if retry is not None:
                    if retry[0] != request_digest:
                        raise ConnectorError(
                            "idempotency_conflict",
                            "The idempotency key was reused with different input.",
                            category="conflict",
                        )
                    return _loaded_json(retry[1])
                self._execute(
                    cursor,
                    """
                    SELECT record, version
                    FROM replica_decision_jobs
                    WHERE scope_key = %s AND job_id = %s
                    FOR UPDATE
                    """,
                    (self.scope_key, job_id),
                )
                row = cursor.fetchone()
                if row is None:
                    raise ConnectorError(
                        "job_not_found",
                        "The job was not found.",
                        category="not_found",
                    )
                record, version = row
                current = _loaded_json(record)
                if version != expected_version:
                    raise ConnectorError(
                        "job_version_conflict",
                        "The job changed before cancellation.",
                        category="conflict",
                    )
                saved_record = dict(current, state="cancelled")
                saved = dict(saved_record, version=expected_version + 1)
                self._execute(
                    cursor,
                    """
                    UPDATE replica_decision_jobs
                    SET record = %s::jsonb, version = version + 1,
                        cancellation_idempotency_key = %s
                    WHERE scope_key = %s AND job_id = %s AND version = %s
                    """,
                    (
                        json.dumps(saved_record),
                        context.idempotency_key,
                        self.scope_key,
                        job_id,
                        expected_version,
                    ),
                )
                self._execute(
                    cursor,
                    """
                    INSERT INTO replica_decision_idempotency
                      (scope_key, operation, idempotency_key, request_digest, result)
                    VALUES (%s, 'cancel', %s, %s, %s::jsonb)
                    """,
                    (
                        self.scope_key,
                        context.idempotency_key,
                        request_digest,
                        json.dumps(saved),
                    ),
                )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return saved


class AzurePostgresCandidateConnector(_AzurePostgresConnector):
    """Blob-backed immutable candidates with PostgreSQL promotion generations."""

    def __init__(
        self,
        connection_factory: ConnectionFactory,
        artifacts: AzureBlobArtifactConnector,
        scope: RuntimeScope,
    ):
        super().__init__(connection_factory, scope)
        self.artifacts = artifacts

    def put(self, candidate: Candidate, context: OperationContext) -> Candidate:
        self._check(context)
        for artifact in candidate.artifacts:
            if _digest(artifact.data) != artifact.digest:
                raise ConnectorError(
                    "candidate_digest_mismatch",
                    "A candidate artifact does not match its digest.",
                    category="integrity",
                )
            self.artifacts.put(artifact, context)
        descriptor = {
            "id": candidate.id,
            "digest": str(candidate.digest),
            "contentDigest": str(
                _candidate_content_digest(candidate.manifest, candidate.artifacts)
            ),
            "manifest": _json_value(candidate.manifest),
            "artifacts": [
                {
                    "digest": str(artifact.digest),
                    "mediaType": artifact.media_type,
                    "metadata": _json_value(artifact.metadata),
                }
                for artifact in candidate.artifacts
            ],
        }
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (
                        "replica-decision-candidate:"
                        f"{self.scope_key}:{candidate.id}",
                    ),
                )
                self._execute(
                    cursor,
                    """
                    SELECT digest, descriptor FROM replica_decision_candidates
                    WHERE scope_key = %s AND candidate_id = %s
                    FOR UPDATE
                    """,
                    (self.scope_key, candidate.id),
                )
                existing = cursor.fetchone()
                if existing is not None:
                    if (
                        existing[0] != str(candidate.digest)
                        or _loaded_json(existing[1]) != descriptor
                    ):
                        raise ConnectorError(
                            "candidate_immutable",
                            "The candidate ID already identifies different content.",
                            category="integrity",
                        )
                    return candidate
                self._execute(
                    cursor,
                    """
                    INSERT INTO replica_decision_candidates
                      (scope_key, candidate_id, digest, descriptor)
                    VALUES (%s, %s, %s, %s::jsonb)
                    """,
                    (
                        self.scope_key,
                        candidate.id,
                        str(candidate.digest),
                        json.dumps(descriptor),
                    ),
                )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return candidate

    def get(self, candidate_id: str, context: OperationContext) -> Candidate:
        self._check(context, hide=True)
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    SELECT descriptor FROM replica_decision_candidates
                    WHERE scope_key = %s AND candidate_id = %s
                    """,
                    (self.scope_key, candidate_id),
                )
                row = cursor.fetchone()
        except Exception as error:
            raise _database_error(error) from error
        if row is None:
            raise ConnectorError(
                "candidate_not_found",
                "The candidate was not found.",
                category="not_found",
            )
        descriptor = _loaded_json(row[0])
        try:
            artifacts = tuple(
                self.artifacts.get(_content_digest(item["digest"]), context)
                for item in descriptor["artifacts"]
            )
            candidate = Candidate(
                descriptor["id"],
                _content_digest(descriptor["digest"]),
                descriptor["manifest"],
                artifacts,
            )
        except (KeyError, TypeError, ValueError):
            raise ConnectorError(
                "candidate_damaged",
                "The candidate descriptor is invalid.",
                category="integrity",
            ) from None
        if (
            candidate.id != candidate_id
            or str(_candidate_content_digest(candidate.manifest, candidate.artifacts))
            != descriptor.get("contentDigest")
        ):
            raise ConnectorError(
                "candidate_damaged",
                "The candidate no longer matches its immutable identity.",
                category="integrity",
            )
        return candidate

    def promote(
        self,
        candidate_id: str,
        *,
        expected_generation: int,
        operation: str,
        context: OperationContext,
    ) -> Promotion:
        self._check(context)
        if operation not in ("promote", "rollback"):
            raise ConnectorError(
                "promotion_operation_invalid",
                "A promotion operation must be promote or rollback.",
                category="invalid_input",
            )
        request_digest = _request_digest(
            {
                "candidateId": candidate_id,
                "expectedGeneration": expected_generation,
                "operation": operation,
                "owner": {"kind": context.owner.kind, "id": context.owner.id},
                "scope": self.scope_key,
            }
        )
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (f"replica-decision-promotion:{self.scope_key}",),
                )
                self._execute(
                    cursor,
                    """
                    SELECT generation, candidate_id, previous_candidate_id,
                           operation, owner_kind, owner_id, request_digest
                    FROM replica_decision_promotions
                    WHERE scope_key = %s AND idempotency_key = %s
                    FOR UPDATE
                    """,
                    (self.scope_key, context.idempotency_key),
                )
                retry = cursor.fetchone()
                if retry is not None:
                    if retry[6] != request_digest:
                        raise ConnectorError(
                            "idempotency_conflict",
                            "The idempotency key was reused with different input.",
                            category="conflict",
                        )
                    return _promotion_from_row(retry)
                self._execute(
                    cursor,
                    """
                    SELECT generation, candidate_id
                    FROM replica_decision_promotions
                    WHERE scope_key = %s
                    ORDER BY generation DESC LIMIT 1
                    FOR UPDATE
                    """,
                    (self.scope_key,),
                )
                current = cursor.fetchone()
                generation = current[0] if current is not None else 0
                previous = current[1] if current is not None else None
                if generation != expected_generation:
                    raise ConnectorError(
                        "promotion_generation_conflict",
                        "The promotion generation changed.",
                        category="conflict",
                    )
                self._execute(
                    cursor,
                    """
                    SELECT 1 FROM replica_decision_candidates
                    WHERE scope_key = %s AND candidate_id = %s
                    """,
                    (self.scope_key, candidate_id),
                )
                if cursor.fetchone() is None:
                    raise ConnectorError(
                        "candidate_not_found",
                        "The candidate was not found.",
                        category="not_found",
                    )
                promotion = Promotion(
                    generation + 1,
                    candidate_id,
                    previous,
                    operation,
                    context.owner,
                )
                self._execute(
                    cursor,
                    """
                    INSERT INTO replica_decision_promotions
                      (scope_key, generation, candidate_id, previous_candidate_id,
                       operation, owner_kind, owner_id, idempotency_key, request_digest)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        self.scope_key,
                        promotion.generation,
                        promotion.candidate_id,
                        promotion.previous_candidate_id,
                        promotion.operation,
                        promotion.owner.kind,
                        promotion.owner.id,
                        context.idempotency_key,
                        request_digest,
                    ),
                )
        except ConnectorError:
            raise
        except Exception as error:
            raise _database_error(error) from error
        return promotion

    def current(self, context: OperationContext) -> Promotion | None:
        check_context(context)
        if context.scope != self.scope:
            return None
        try:
            with self._transaction() as cursor:
                self._execute(
                    cursor,
                    """
                    SELECT generation, candidate_id, previous_candidate_id,
                           operation, owner_kind, owner_id, request_digest
                    FROM replica_decision_promotions
                    WHERE scope_key = %s
                    ORDER BY generation DESC LIMIT 1
                    """,
                    (self.scope_key,),
                )
                row = cursor.fetchone()
        except Exception as error:
            raise _database_error(error) from error
        return None if row is None else _promotion_from_row(row)

    def artifact_path(
        self,
        candidate_id: str,
        name: str,
        context: OperationContext,
    ) -> Path:
        candidate = self.get(candidate_id, context)
        artifact = next(
            (
                item
                for item in candidate.artifacts
                if item.metadata.get("name") == name
            ),
            None,
        )
        if artifact is None:
            raise ConnectorError(
                "candidate_artifact_not_found",
                "The candidate artifact was not found.",
                category="not_found",
            )
        directory = Path(tempfile.mkdtemp(prefix="replica-azure-candidate-"))
        path = directory / name
        path.write_bytes(artifact.data)
        os.chmod(path, 0o400)
        return path


class AzureContainerAppsTrainingConnector:
    """One bounded, scale-to-zero Azure job execution per training request."""

    name = "azure-container-apps-job"
    production_eligible = True

    def __init__(
        self,
        transport: AzureJobTransport,
        job_name: str,
        *,
        supports_hard_credit_budget: bool = True,
        poll_interval_seconds: float = 2,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.transport = transport
        self.job_name = job_name
        self.supports_hard_credit_budget = supports_hard_credit_budget
        self.poll_interval_seconds = poll_interval_seconds
        self.sleep = sleep

    def train(
        self,
        taskset: Any,
        work_directory: Path,
        *,
        max_updates: int,
        context: OperationContext,
        credential: Credential | None,
    ) -> TrainingResult:
        check_context(context)
        del work_directory
        if context.budget_mode == "hard" and not self.supports_hard_credit_budget:
            raise ConnectorError(
                "hard_credit_budget_unsupported",
                "The Azure job connector cannot enforce a hard credit budget.",
                category="invalid_input",
            )
        remaining = context.deadline - time.monotonic()
        payload = {
            "operationId": context.operation_id,
            "idempotencyKey": context.idempotency_key,
            "scope": {
                "tenantId": context.scope.tenant_id,
                "repository": context.scope.repository,
            },
            "taskset": {
                "reference": f"taskset:{taskset_digest(taskset).value}",
                "exportId": taskset.metadata.get("exportId"),
                "taskCount": len(taskset.tasks),
            },
            "limits": {
                "maxUpdates": max_updates,
                "deadlineEpoch": time.time() + max(0, remaining),
                "maxCredits": context.max_credits,
                "budgetMode": context.budget_mode,
            },
        }
        token = credential.value if credential is not None else None
        try:
            started = self.transport.start(
                self.job_name,
                payload,
                bearer_token=token,
            )
            execution_id = started["executionId"]
        except (KeyError, TypeError):
            raise ConnectorError(
                "azure_training_response_invalid",
                "Azure returned an invalid training execution.",
                category="integrity",
            ) from None
        except Exception as error:
            raise ConnectorError(
                "azure_training_unavailable",
                "The Azure training job could not start.",
                category="unavailable",
                retryable=True,
            ) from error
        while True:
            try:
                check_context(context)
            except ConnectorError:
                self._cancel(execution_id, token)
                raise
            try:
                status = self.transport.status(
                    execution_id,
                    bearer_token=token,
                )
            except Exception as error:
                try:
                    check_context(context)
                except ConnectorError:
                    self._cancel(execution_id, token)
                    raise
                raise ConnectorError(
                    "azure_training_unavailable",
                    "The Azure training job status is unavailable.",
                    category="unavailable",
                    retryable=True,
                ) from error
            try:
                check_context(context)
            except ConnectorError:
                self._cancel(execution_id, token)
                raise
            state = status.get("state")
            if state in _TERMINAL_JOB_STATES:
                break
            self.sleep(
                min(
                    self.poll_interval_seconds,
                    max(0, context.deadline - time.monotonic()),
                )
            )
        if state == "cancelled":
            raise ConnectorError(
                "azure_training_cancelled",
                "The Azure training job was cancelled.",
                category="cancelled",
            )
        if state != "succeeded":
            raise ConnectorError(
                "azure_training_failed",
                "The Azure training job failed.",
                category="internal",
            )
        return _training_result(status, context, self.name)

    def _cancel(self, execution_id: str, token: str | None) -> None:
        try:
            self.transport.cancel(execution_id, bearer_token=token)
        except Exception:
            pass


class AzureEndpointInferenceConnector:
    """Scoped inference through a customer endpoint, never a training/admin API."""

    name = "azure-customer-endpoint"

    def __init__(
        self,
        transport: AzureEndpointTransport,
        *,
        endpoint_name: str,
        expected_generation: int | Callable[[], int],
        credential_audience: str = "inference",
    ):
        self.transport = transport
        self.endpoint_name = endpoint_name
        self.credential_audience = credential_audience
        self.expected_generation = expected_generation

    def predict(
        self,
        adapter: Path,
        request: Mapping[str, Any],
        *,
        context: OperationContext,
        credential: Credential | None,
    ) -> Mapping[str, Any]:
        check_context(context)
        if credential is not None and credential.audience != self.credential_audience:
            raise ConnectorError(
                "inference_credential_unauthorized",
                "The credential is not scoped to the inference endpoint.",
                category="unauthorized",
            )
        expected_generation = (
            self.expected_generation()
            if callable(self.expected_generation)
            else self.expected_generation
        )
        if (
            isinstance(expected_generation, bool)
            or not isinstance(expected_generation, int)
            or expected_generation < 1
        ):
            raise ConnectorError(
                "expected_generation_invalid",
                "The expected inference generation is invalid.",
                category="invalid_input",
            )
        requested_generation = request.get("expectedGeneration")
        if (
            requested_generation is not None
            and requested_generation != expected_generation
        ):
            raise ConnectorError(
                "inference_generation_conflict",
                "The inference request expects another promotion generation.",
                category="conflict",
            )
        token = credential.value if credential is not None else None
        try:
            readiness = self.transport.readiness(bearer_token=token)
        except Exception as error:
            raise ConnectorError(
                "azure_inference_unavailable",
                "The customer inference endpoint is unavailable.",
                category="unavailable",
                retryable=True,
            ) from error
        generation = readiness.get("generation")
        if generation != expected_generation:
            raise ConnectorError(
                "inference_generation_conflict",
                "The inference endpoint serves another promotion generation.",
                category="conflict",
                retryable=readiness.get("state") in {"starting", "updating"},
            )
        if readiness.get("state") != "ready":
            raise ConnectorError(
                "inference_cold_start",
                "The inference endpoint is not ready.",
                category="unavailable",
                retryable=True,
            )
        check_context(context)
        try:
            result = self.transport.predict(
                dict(
                    request,
                    endpoint=self.endpoint_name,
                    expectedGeneration=expected_generation,
                ),
                bearer_token=token,
            )
        except Exception as error:
            raise ConnectorError(
                "azure_inference_unavailable",
                "The customer inference endpoint is unavailable.",
                category="unavailable",
                retryable=True,
            ) from error
        check_context(context)
        if not isinstance(result, Mapping):
            raise ConnectorError(
                "azure_inference_response_invalid",
                "The customer inference endpoint returned an invalid response.",
                category="integrity",
            )
        if result.get("generation") != expected_generation:
            raise ConnectorError(
                "inference_generation_conflict",
                "The inference endpoint scored another promotion generation.",
                category="conflict",
            )
        return dict(
            result,
            operationId=context.operation_id,
            readiness={
                "state": readiness["state"],
                "coldStart": bool(readiness.get("coldStart", False)),
                "generation": generation,
            },
        )


class AzureManagedIdentityCredentialConnector(_AzureScopedConnector):
    """Short-lived workload identity credentials with no durable cloud keys."""

    def __init__(
        self,
        provider: AzureTokenProvider,
        scope: RuntimeScope,
        *,
        allowed_audiences: Sequence[str],
    ):
        super().__init__(scope)
        self.provider = provider
        self.allowed_audiences = frozenset(allowed_audiences)

    def acquire(
        self, audience: str, context: OperationContext
    ) -> Credential | None:
        self._check(context)
        if audience not in self.allowed_audiences:
            raise ConnectorError(
                "credential_audience_unauthorized",
                "The requested credential audience is not allowed.",
                category="unauthorized",
            )
        try:
            token = self.provider.get_token(audience)
            value = token.token
            expires_on = float(token.expires_on)
        except Exception as error:
            raise ConnectorError(
                "managed_identity_unavailable",
                "Azure managed identity could not mint a credential.",
                category="unavailable",
                retryable=True,
            ) from error
        lifetime = max(0, expires_on - time.time())
        expires_at = min(context.deadline, time.monotonic() + lifetime)
        if not value or expires_at <= time.monotonic():
            raise ConnectorError(
                "managed_identity_expired",
                "Azure managed identity returned an expired credential.",
                category="unavailable",
                retryable=True,
            )
        return Credential(
            value,
            expires_at,
            audience,
            context.scope,
            context.operation_id,
        )


class AzureObservabilityConnector(_AzureScopedConnector):
    """Emit allowlisted usage and operation fields to Pino/OpenTelemetry bridges."""

    def __init__(self, sink: AzureTelemetrySink, scope: RuntimeScope):
        super().__init__(scope)
        self.sink = sink

    def record(self, usage: Usage, context: OperationContext) -> None:
        self._check(context)
        if usage.scope != context.scope or usage.operation_id != context.operation_id:
            raise ConnectorError(
                "usage_scope_mismatch",
                "Usage attribution does not match the operation.",
                category="invalid_input",
            )
        _validate_usage_fields(usage.kind, usage.unit, usage.currency)
        metadata = {
            key: value
            for key, value in usage.metadata.items()
            if key in _SAFE_USAGE_METADATA
            and isinstance(value, (str, int, float, bool, type(None)))
        }
        attributes = {
            "event": "replica.decision.usage",
            "operation_id": usage.operation_id,
            "tenant_id_hash": hashlib.sha256(
                context.scope.tenant_id.encode("utf-8")
            ).hexdigest()[:16],
            "repository_hash": hashlib.sha256(
                context.scope.repository.encode("utf-8")
            ).hexdigest()[:16],
            "connector": usage.connector,
            "kind": usage.kind,
            "quantity": usage.quantity,
            "unit": usage.unit,
            "cost": usage.cost,
            "currency": usage.currency,
            "source": usage.source,
            **metadata,
        }
        self.sink.emit("replica.decision.usage", attributes)

    def record_operation(
        self,
        name: str,
        status: str,
        context: OperationContext,
        *,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        self._check(context)
        safe_metadata = {
            key: value
            for key, value in (metadata or {}).items()
            if key in _SAFE_USAGE_METADATA
            and isinstance(value, (str, int, float, bool, type(None)))
        }
        self.sink.emit(
            "replica.decision.operation",
            {
                "event": "replica.decision.operation",
                "name": name,
                "status": status,
                "operation_id": context.operation_id,
                "tenant_id_hash": hashlib.sha256(
                    context.scope.tenant_id.encode("utf-8")
                ).hexdigest()[:16],
                "repository_hash": hashlib.sha256(
                    context.scope.repository.encode("utf-8")
                ).hexdigest()[:16],
                **safe_metadata,
            },
        )


@dataclass(frozen=True)
class AzureConnectorBundle:
    """Azure composition plus the provider-neutral connector set."""

    connectors: RuntimeConnectors
    scope: RuntimeScope
    postgres_schema: str = AZURE_POSTGRES_SCHEMA


def create_azure_connector_bundle(
    *,
    scope: RuntimeScope,
    blob_container: AzureBlobContainer,
    connection_factory: ConnectionFactory,
    training: Mapping[str, AzureContainerAppsTrainingConnector],
    inference: Mapping[str, AzureEndpointInferenceConnector],
    token_provider: AzureTokenProvider,
    credential_audiences: Sequence[str],
    telemetry_sink: AzureTelemetrySink,
    retention_hook: RetentionHook | None = None,
) -> AzureConnectorBundle:
    """Compose the first customer-operated Azure reference bundle."""
    artifacts = AzureBlobArtifactConnector(
        blob_container,
        scope,
        retention_hook=retention_hook,
    )
    connectors = RuntimeConnectors(
        tasksets=AzureBlobTasksetConnector(
            blob_container,
            scope,
            retention_hook=retention_hook,
        ),
        artifacts=artifacts,
        jobs=AzurePostgresJobConnector(connection_factory, scope),
        candidates=AzurePostgresCandidateConnector(
            connection_factory,
            artifacts,
            scope,
        ),
        training=training,
        inference=inference,
        credentials=AzureManagedIdentityCredentialConnector(
            token_provider,
            scope,
            allowed_audiences=credential_audiences,
        ),
        observability=AzureObservabilityConnector(telemetry_sink, scope),
    )
    return AzureConnectorBundle(connectors, scope)


def _loaded_json(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ConnectorError(
            "azure_postgres_state_damaged",
            "The PostgreSQL decision state is invalid.",
            category="integrity",
        )
    return value


def _database_error(error: Exception) -> ConnectorError:
    if isinstance(error, ConnectorError):
        return error
    return ConnectorError(
        "azure_postgres_unavailable",
        "The Replica PostgreSQL decision state is unavailable.",
        category="unavailable",
        retryable=True,
    )


def _check_ttl(ttl_seconds: float) -> None:
    if not math.isfinite(ttl_seconds) or ttl_seconds <= 0:
        raise ConnectorError(
            "lease_ttl_invalid",
            "A job lease needs a positive lifetime.",
            category="invalid_input",
        )


def _content_digest(value: str) -> ContentDigest:
    algorithm, separator, digest = value.partition(":")
    if not separator:
        raise ValueError("invalid digest")
    return ContentDigest(algorithm, digest)


def _promotion_from_row(row: Sequence[Any]) -> Promotion:
    return Promotion(
        row[0],
        row[1],
        row[2],
        row[3],
        RuntimeOwner(row[4], row[5]),
    )


def _training_result(
    status: Mapping[str, Any],
    context: OperationContext,
    connector: str,
) -> TrainingResult:
    result = status.get("result")
    if not isinstance(result, Mapping):
        raise ConnectorError(
            "azure_training_response_invalid",
            "Azure returned an invalid training result.",
            category="integrity",
        )
    try:
        adapter = base64.b64decode(result["adapterBase64"], validate=True)
        usage_records = []
        for item in result.get("usage", ()):
            _validate_usage_fields(
                item["kind"],
                item["unit"],
                item.get("currency"),
            )
            usage_records.append(
                Usage(
                operation_id=context.operation_id,
                scope=context.scope,
                connector=connector,
                kind=item["kind"],
                quantity=float(item["quantity"]),
                unit=item["unit"],
                cost=float(item["cost"]) if item.get("cost") is not None else None,
                currency=item.get("currency"),
                metadata={
                    **{
                        key: value
                        for key, value in item.get("metadata", {}).items()
                        if key in _SAFE_USAGE_METADATA
                        and not key.startswith("azure.")
                    },
                },
                source="azure",
            )
            )
        usage = tuple(usage_records)
        training = TrainingResult(
            result["adapterName"],
            adapter,
            result["baselineReport"],
            result["candidateReport"],
            result.get("metadata", {}),
            int(result["updatesCompleted"]),
            usage,
        )
    except (KeyError, TypeError, ValueError):
        raise ConnectorError(
            "azure_training_response_invalid",
            "Azure returned an invalid training result.",
            category="integrity",
        ) from None
    if (
        context.budget_mode == "hard"
        and context.max_credits is not None
        and sum(
            item.quantity
            for item in usage
            if item.kind == "training_credits" and item.unit == "credits"
        )
        > context.max_credits
    ):
        raise ConnectorError(
            "credit_budget_exceeded",
            "Azure reported usage above the hard credit budget.",
            category="integrity",
        )
    return training


def _validate_usage_fields(
    kind: Any,
    unit: Any,
    currency: Any,
) -> None:
    if (
        kind not in _USAGE_KINDS
        or unit not in _USAGE_UNITS
        or (
            currency is not None
            and (
                not isinstance(currency, str)
                or _CURRENCY.fullmatch(currency) is None
            )
        )
    ):
        raise ConnectorError(
            "usage_field_invalid",
            "Provider usage contains an unsupported kind, unit, or currency.",
            category="invalid_input",
        )


def _extract_taskset_archive(source: tarfile.TarFile, root: Path) -> None:
    for member in source.getmembers():
        target = (root / member.name).resolve()
        if (
            member.islnk()
            or member.issym()
            or member.isdev()
            or root.resolve() not in target.parents
        ):
            raise tarfile.TarError("unsafe taskset archive")
        extracted = source.extractfile(member)
        if extracted is None:
            raise tarfile.TarError("missing taskset archive member")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(extracted.read())
        os.chmod(target, 0o400)
