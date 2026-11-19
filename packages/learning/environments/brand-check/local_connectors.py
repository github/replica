"""Private single-node implementations of the decision-runtime connector contracts."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from .connectors import (
    Artifact,
    Candidate,
    ConnectorError,
    ContentDigest,
    Credential,
    CredentialConnector,
    JobLease,
    OperationContext,
    ObservabilityConnector,
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
from .taskset import Taskset, TasksetError, load_taskset

try:
    import fcntl
except ImportError:  # pragma: no cover - the local bundle supports Unix hosts and containers.
    fcntl = None

_LOCAL_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$")


def _json_data(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _json_data(member) for key, member in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_data(member) for member in value]
    return value


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            _json_data(value),
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode()


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def taskset_digest(taskset: Taskset) -> ContentDigest:
    """Return the stable identity used by the existing local runtime."""
    identity = {
        "manifest": _json_data(taskset.metadata),
        "tasks": [
            {
                "id": task.id,
                "split": task.split,
                "state": _json_data(task.state),
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
                    key: _json_data(question.spec)
                    for key, question in task.questions.items()
                },
                "labels": _json_data(task.labels),
                "provenance": _json_data(task.provenance),
            }
            for task in taskset.tasks
        ],
    }
    return _digest(_json_bytes(identity))


def _candidate_content_digest(
    manifest: Mapping[str, Any],
    artifacts: Sequence[Artifact],
) -> ContentDigest:
    identity = hashlib.sha256()
    identity.update(_json_bytes(manifest))
    for artifact in artifacts:
        identity.update(b"\0")
        identity.update(
            _json_bytes(
                {
                    "digest": str(artifact.digest),
                    "mediaType": artifact.media_type,
                    "metadata": artifact.metadata,
                }
            )
        )
        identity.update(b"\0")
        identity.update(artifact.data)
    return ContentDigest("sha256", identity.hexdigest())


def _write_json_atomic(path: Path, value: Any, *, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(_json_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _write_immutable(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _sync_directory(directory: Path) -> None:
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _read_object(path: Path, *, code: str, message: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ConnectorError(code, message, category="not_found") from None
    except (OSError, ValueError):
        raise ConnectorError(
            "local_state_damaged",
            f"{path.name} is not valid local connector state.",
            category="integrity",
        ) from None
    if not isinstance(value, dict):
        raise ConnectorError(
            "local_state_damaged",
            f"{path.name} is not a JSON object.",
            category="integrity",
        )
    return value


def _scope_key(scope: RuntimeScope) -> str:
    return hashlib.sha256(
        f"{scope.tenant_id}\0{scope.repository}".encode()
    ).hexdigest()


def _checked_identifier(value: str, kind: str) -> str:
    if not isinstance(value, str) or not _LOCAL_IDENTIFIER.fullmatch(value):
        raise ConnectorError(
            f"{kind}_id_invalid",
            f"The {kind} ID is not valid for local storage.",
            category="invalid_input",
        )
    return value


class _ScopedConnector:
    def __init__(self, scope: RuntimeScope):
        self.scope = scope

    def _check(self, context: OperationContext, *, hide: bool = False) -> None:
        check_context(context)
        if context.scope != self.scope:
            raise ConnectorError(
                "scoped_record_not_found" if hide else "scope_unauthorized",
                "The requested record was not found."
                if hide
                else "The operation scope does not match this local connector bundle.",
                category="not_found" if hide else "unauthorized",
            )


class LocalTasksetConnector(_ScopedConnector):
    """Register and resolve private immutable tasksets for one runtime scope."""

    def __init__(
        self,
        root: Path,
        taskset_directory: str | os.PathLike[str] | None,
        scope: RuntimeScope,
    ):
        super().__init__(scope)
        self.root = root / "tasksets"
        self.idempotency = self.root / ".idempotency"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.idempotency.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        os.chmod(self.idempotency, 0o700)
        self._lock = threading.RLock()
        self.taskset = None
        self.digest = None
        self.reference = None
        self._mounted: dict[str, Taskset] = {}
        if taskset_directory is not None:
            self.taskset = load_taskset(taskset_directory)
            self.digest = taskset_digest(self.taskset)
            self.reference = f"taskset:{self.digest.value}"
            self._mounted[self.reference] = self.taskset

    def register(
        self, bundle: TasksetBundle, context: OperationContext
    ) -> TasksetArtifact:
        self._check(context)
        claimed_digest = bundle.digest
        ordered_images = sorted(bundle.images, key=lambda image: image.path)
        request_identity = hashlib.sha256()
        request_identity.update(
            _json_bytes(
                {
                    "digest": str(claimed_digest) if claimed_digest else None,
                    "manifest": bundle.manifest,
                    "tasks": bundle.tasks,
                    "images": [
                        {
                            "path": image.path,
                            "mediaType": image.media_type,
                            "digest": str(image.digest),
                        }
                        for image in ordered_images
                    ],
                }
            )
        )
        for image in ordered_images:
            request_identity.update(b"\0")
            request_identity.update(image.data)
        request_digest = ContentDigest("sha256", request_identity.hexdigest())
        idempotency_path = self.idempotency / hashlib.sha256(
            context.idempotency_key.encode()
        ).hexdigest()
        with self._lock:
            if idempotency_path.exists():
                saved = _read_object(
                    idempotency_path,
                    code="taskset_idempotency_not_found",
                    message="The taskset retry record was not found.",
                )
                if saved.get("requestDigest") != str(request_digest):
                    raise ConnectorError(
                        "idempotency_conflict",
                        "The idempotency key was reused with different input.",
                        category="conflict",
                    )
            staging = self.root / f".register-{uuid.uuid4().hex}"
            try:
                check_context(context)
                staging.mkdir(mode=0o700)
                _materialize_taskset_bundle(staging, bundle, context)
                taskset = load_taskset(staging)
                check_context(context)
                actual = taskset_digest(taskset)
                if claimed_digest is not None and actual != claimed_digest:
                    claimed_reference = f"taskset:{claimed_digest.value}"
                    immutable = (
                        claimed_reference in self._mounted
                        or (self.root / claimed_digest.value).exists()
                    )
                    raise ConnectorError(
                        "taskset_immutable" if immutable else "taskset_digest_mismatch",
                        "The taskset digest already identifies different content."
                        if immutable
                        else "The taskset contents do not match the claimed digest.",
                        category="conflict" if immutable else "invalid_input",
                    )
                reference = f"taskset:{actual.value}"
                destination = self.root / actual.value
                if destination.exists():
                    existing = self.resolve(reference, context)
                    if not idempotency_path.exists():
                        check_context(context)
                        _write_immutable(
                            idempotency_path,
                            _json_bytes(
                                {
                                    "reference": reference,
                                    "requestDigest": str(request_digest),
                                }
                            ),
                        )
                    return existing
                check_context(context)
                os.replace(staging, destination)
                _sync_directory(self.root)
                if not idempotency_path.exists():
                    _write_immutable(
                        idempotency_path,
                        _json_bytes(
                            {
                                "reference": reference,
                                "requestDigest": str(request_digest),
                            }
                        ),
                    )
            except TasksetError as error:
                raise ConnectorError(
                    "taskset_invalid",
                    str(error),
                    category="invalid_input",
                ) from None
            finally:
                shutil.rmtree(staging, ignore_errors=True)
        return TasksetArtifact(reference, actual, load_taskset(destination))

    def resolve(self, reference: str, context: OperationContext) -> TasksetArtifact:
        self._check(context, hide=True)
        if reference.startswith("taskset:"):
            value = reference.removeprefix("taskset:")
            directory = self.root / value
            try:
                digest = ContentDigest("sha256", value)
            except ValueError:
                digest = None
            if digest is not None and directory.is_dir():
                try:
                    taskset = load_taskset(directory)
                except TasksetError:
                    raise ConnectorError(
                        "taskset_damaged",
                        "The taskset no longer matches its immutable identity.",
                        category="integrity",
                    ) from None
                if taskset_digest(taskset) != digest:
                    raise ConnectorError(
                        "taskset_damaged",
                        "The taskset no longer matches its immutable identity.",
                        category="integrity",
                    )
                return TasksetArtifact(reference, digest, taskset)
        mounted = self._mounted.get(reference)
        if mounted is not None:
            try:
                mounted = load_taskset(mounted.directory)
            except TasksetError:
                raise ConnectorError(
                    "taskset_damaged",
                    "The taskset no longer matches its immutable identity.",
                    category="integrity",
                ) from None
            digest = taskset_digest(mounted)
            if reference != f"taskset:{digest.value}":
                raise ConnectorError(
                    "taskset_damaged",
                    "The taskset no longer matches its immutable identity.",
                    category="integrity",
                )
            return TasksetArtifact(reference, digest, mounted)
        if not reference.startswith("taskset:"):
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            )
        value = reference.removeprefix("taskset:")
        directory = self.root / value
        try:
            digest = ContentDigest("sha256", value)
        except ValueError:
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            ) from None
        if not directory.is_dir():
            raise ConnectorError(
                "taskset_not_found",
                "The taskset was not found.",
                category="not_found",
            )
        try:
            taskset = load_taskset(directory)
        except TasksetError:
            raise ConnectorError(
                "taskset_damaged",
                "The taskset no longer matches its immutable identity.",
                category="integrity",
            ) from None
        if taskset_digest(taskset) != digest:
            raise ConnectorError(
                "taskset_damaged",
                "The taskset no longer matches its immutable identity.",
                category="integrity",
            )
        return TasksetArtifact(reference, digest, taskset)


def _materialize_taskset_bundle(
    directory: Path, bundle: TasksetBundle, context: OperationContext
) -> None:
    check_context(context)
    paths = [_taskset_image_parts(image.path) for image in bundle.images]
    reserved = {("taskset.json",), ("tasks.jsonl",)}
    for parts in paths:
        if parts in reserved:
            raise ConnectorError(
                "taskset_image_path_invalid",
                "A taskset image path conflicts with a taskset data file.",
                category="invalid_input",
            )
    path_set = set(paths)
    if len(path_set) != len(paths) or any(
        parts[:index] in path_set
        for parts in path_set
        for index in range(1, len(parts))
    ):
        raise ConnectorError(
            "taskset_image_conflict",
            "Taskset image paths must not repeat or collide as files and directories.",
            category="invalid_input",
        )
    _write_immutable(directory / "taskset.json", _json_bytes(bundle.manifest))
    check_context(context)
    _write_immutable(
        directory / "tasks.jsonl",
        b"".join(_json_bytes(task) for task in bundle.tasks),
    )
    expected: dict[str, tuple[str, str]] = {}
    for task in bundle.tasks:
        images = task.get("images") if isinstance(task, Mapping) else None
        if not isinstance(images, list):
            continue
        for image in images:
            if not isinstance(image, Mapping):
                continue
            path = image.get("path")
            media_type = image.get("mediaType")
            digest = image.get("digest")
            if not all(isinstance(value, str) for value in (path, media_type, digest)):
                continue
            identity = (media_type, digest)
            prior = expected.get(path)
            if prior is not None and prior != identity:
                raise ConnectorError(
                    "taskset_image_conflict",
                    "A taskset image path has inconsistent metadata.",
                    category="invalid_input",
                )
            expected[path] = identity
    seen: dict[str, Any] = {}
    for image, parts in zip(bundle.images, paths, strict=True):
        check_context(context)
        if _digest(image.data) != image.digest:
            raise ConnectorError(
                "taskset_image_digest_mismatch",
                "A taskset image does not match its claimed digest.",
                category="invalid_input",
            )
        prior = seen.get(image.path)
        identity = (image.media_type, image.digest, image.data)
        if expected.get(image.path) != (image.media_type, str(image.digest)):
            raise ConnectorError(
                "taskset_image_metadata_mismatch",
                "A transferred image does not match the taskset image metadata.",
                category="invalid_input",
            )
        if prior is not None:
            raise ConnectorError(
                "taskset_image_conflict",
                "A taskset image path appears more than once.",
                category="invalid_input",
            )
        _write_immutable(directory.joinpath(*parts), image.data)
        seen[image.path] = identity
    check_context(context)
    if set(seen) != set(expected):
        raise ConnectorError(
            "taskset_images_incomplete",
            "The transfer must contain every taskset image exactly once.",
            category="invalid_input",
        )


def _taskset_image_parts(path: str) -> tuple[str, ...]:
    if (
        not isinstance(path, str)
        or not path
        or "\x00" in path
        or "\\" in path
        or path.startswith("/")
    ):
        raise ConnectorError(
            "taskset_image_path_invalid",
            "A taskset image path must stay inside the taskset.",
            category="invalid_input",
        )
    parts = tuple(path.split("/"))
    if any(part in ("", ".", "..") for part in parts):
        raise ConnectorError(
            "taskset_image_path_invalid",
            "A taskset image path must use canonical relative segments.",
            category="invalid_input",
        )
    return parts


class LocalArtifactConnector(_ScopedConnector):
    """Store private immutable bytes by digest."""

    def __init__(self, root: Path, scope: RuntimeScope):
        super().__init__(scope)
        self.root = root / "artifacts" / "sha256"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root.parent, 0o700)
        os.chmod(self.root, 0o700)
        self._lock = threading.RLock()

    def put(self, artifact: Artifact, context: OperationContext) -> Artifact:
        self._check(context)
        if _digest(artifact.data) != artifact.digest:
            raise ConnectorError(
                "artifact_digest_mismatch",
                "The artifact bytes do not match the claimed digest.",
                category="integrity",
            )
        data_path, metadata_path = self._paths(artifact.digest)
        with self._lock:
            if data_path.exists() and not metadata_path.exists():
                try:
                    data = data_path.read_bytes()
                except OSError:
                    raise ConnectorError(
                        "artifact_unreadable",
                        "The artifact cannot be read.",
                        category="integrity",
                    ) from None
                if _digest(data) != artifact.digest or data != artifact.data:
                    raise ConnectorError(
                        "artifact_damaged",
                        "The stored artifact no longer matches its immutable identity.",
                        category="integrity",
                    )
                _write_immutable(
                    metadata_path,
                    _json_bytes(
                        {
                            "digest": str(artifact.digest),
                            "mediaType": artifact.media_type,
                            "metadata": artifact.metadata,
                        }
                    ),
                )
                return artifact
            if data_path.exists() or metadata_path.exists():
                existing = self.get(artifact.digest, context)
                if existing != artifact:
                    raise ConnectorError(
                        "artifact_immutable",
                        "The artifact digest already identifies different content.",
                        category="integrity",
                    )
                return existing
            _write_immutable(data_path, artifact.data)
            try:
                _write_immutable(
                    metadata_path,
                    _json_bytes(
                        {
                            "digest": str(artifact.digest),
                            "mediaType": artifact.media_type,
                            "metadata": artifact.metadata,
                        }
                    ),
                )
            except Exception:
                data_path.unlink(missing_ok=True)
                raise
        return artifact

    def get(self, digest: ContentDigest, context: OperationContext) -> Artifact:
        self._check(context, hide=True)
        data_path, metadata_path = self._paths(digest)
        try:
            data = data_path.read_bytes()
        except FileNotFoundError:
            raise ConnectorError(
                "artifact_not_found",
                "The artifact was not found.",
                category="not_found",
            ) from None
        except OSError:
            raise ConnectorError(
                "artifact_unreadable",
                "The artifact cannot be read.",
                category="integrity",
            ) from None
        metadata = _read_object(
            metadata_path,
            code="artifact_not_found",
            message="The artifact was not found.",
        )
        if (
            _digest(data) != digest
            or metadata.get("digest") != str(digest)
            or not isinstance(metadata.get("mediaType"), str)
            or not isinstance(metadata.get("metadata", {}), dict)
        ):
            raise ConnectorError(
                "artifact_damaged",
                "The stored artifact no longer matches its immutable identity.",
                category="integrity",
            )
        return Artifact(
            digest,
            metadata["mediaType"],
            data,
            metadata.get("metadata", {}),
        )

    def _paths(self, digest: ContentDigest) -> tuple[Path, Path]:
        directory = self.root / digest.value[:2]
        return directory / digest.value, directory / f"{digest.value}.json"


class LocalJobConnector(_ScopedConnector):
    """Persist compare-and-swap jobs and exclusive expiring leases."""

    def __init__(self, root: Path, scope: RuntimeScope):
        super().__init__(scope)
        self.jobs = root / "jobs"
        self.idempotency = self.jobs / ".idempotency"
        self.leases = self.jobs / ".leases"
        self.cancellations = self.jobs / ".cancellations"
        for directory in (self.jobs, self.idempotency, self.leases, self.cancellations):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(directory, 0o700)
        for path in self.leases.glob("*.json"):
            path.unlink()
        self._lock = threading.RLock()

    def create(
        self,
        job_id: str,
        record: Mapping[str, Any],
        context: OperationContext,
    ) -> Mapping[str, Any]:
        self._check(context)
        request = {
            "jobId": job_id,
            "record": _json_data(record),
            "scope": _scope_key(context.scope),
        }
        request_digest = _digest(_json_bytes(request))
        idempotency_path = self._idempotency_path(context.idempotency_key)
        with self._lock:
            if idempotency_path.exists():
                retry = _read_object(
                    idempotency_path,
                    code="idempotency_not_found",
                    message="The idempotent request was not found.",
                )
                if retry.get("requestDigest") != str(request_digest):
                    raise ConnectorError(
                        "idempotency_conflict",
                        "The idempotency key was reused with different input.",
                        category="conflict",
                    )
                result = retry.get("result")
                if retry.get("jobId") != job_id or not isinstance(result, dict):
                    raise ConnectorError(
                        "idempotency_damaged",
                        "The stored idempotent request is invalid.",
                        category="integrity",
                    )
                if not self._job_path(job_id).exists():
                    _write_json_atomic(self._job_path(job_id), result)
                return result
            path = self._job_path(job_id)
            if path.exists():
                raise ConnectorError(
                    "job_exists",
                    "The job already exists.",
                    category="conflict",
                )
            saved = dict(_json_data(record), version=1)
            _write_immutable(
                idempotency_path,
                _json_bytes(
                    {
                        "jobId": job_id,
                        "requestDigest": str(request_digest),
                        "result": saved,
                    }
                ),
            )
            _write_json_atomic(path, saved)
        return saved

    def get(self, job_id: str, context: OperationContext) -> Mapping[str, Any]:
        self._check(context, hide=True)
        saved = _read_object(
            self._job_path(job_id),
            code="job_not_found",
            message="The job was not found.",
        )
        version = saved.get("version")
        if version is None:
            saved["version"] = 1
        elif not isinstance(version, int) or version < 1:
            raise ConnectorError(
                "job_damaged",
                "The stored job version is invalid.",
                category="integrity",
            )
        return saved

    def list(
        self,
        states: Sequence[str],
        context: OperationContext,
    ) -> Sequence[Mapping[str, Any]]:
        check_context(context)
        if context.scope != self.scope:
            return ()
        selected = set(states)
        records = []
        for path in sorted(self.jobs.glob("*.json")):
            record = self.get(path.stem, context)
            if record.get("state") in selected:
                records.append(record)
        return tuple(records)

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
        with self._lock:
            self._verify_lease(lease, context)
            current = self.get(job_id, context)
            if current.get("state") == "cancelled":
                raise ConnectorError(
                    "job_cancelled",
                    "A cancelled job cannot advance.",
                    category="conflict",
                )
            if current["version"] != expected_version:
                raise ConnectorError(
                    "job_version_conflict",
                    "The job changed before this update.",
                    category="conflict",
                )
            saved = dict(_json_data(record), version=expected_version + 1)
            _write_json_atomic(self._job_path(job_id), saved)
            return saved

    def cancel(
        self,
        job_id: str,
        *,
        expected_version: int,
        context: OperationContext,
    ) -> Mapping[str, Any]:
        self._check(context)
        with self._lock:
            current = self.get(job_id, context)
            cancellation_path = self._cancellation_path(job_id)
            if cancellation_path.exists():
                cancellation = _read_object(
                    cancellation_path,
                    code="job_cancellation_not_found",
                    message="The job cancellation was not found.",
                )
                if cancellation.get("idempotencyKey") != context.idempotency_key:
                    raise ConnectorError(
                        "job_version_conflict",
                        "The job changed before cancellation.",
                        category="conflict",
                    )
                if current.get("state") == "cancelled":
                    return current
            elif current["version"] != expected_version:
                raise ConnectorError(
                    "job_version_conflict",
                    "The job changed before cancellation.",
                    category="conflict",
                )
            else:
                _write_immutable(
                    cancellation_path,
                    _json_bytes({"idempotencyKey": context.idempotency_key}),
                )
            saved = dict(current, state="cancelled", version=expected_version + 1)
            _write_json_atomic(self._job_path(job_id), saved)
            return saved

    def acquire(
        self,
        job_id: str,
        *,
        ttl_seconds: float,
        context: OperationContext,
    ) -> JobLease:
        self._check(context)
        if not math.isfinite(ttl_seconds) or ttl_seconds <= 0:
            raise ConnectorError(
                "lease_ttl_invalid",
                "A job lease needs a positive lifetime.",
                category="invalid_input",
            )
        with self._lock:
            job = self.get(job_id, context)
            if job.get("state") == "cancelled":
                raise ConnectorError(
                    "job_cancelled",
                    "A cancelled job cannot be leased.",
                    category="conflict",
                )
            path = self._lease_path(job_id)
            now_epoch = time.time()
            if path.exists():
                current = _read_object(
                    path,
                    code="lease_not_found",
                    message="The job lease was not found.",
                )
                if current.get("expiresAtEpoch", 0) > now_epoch:
                    raise ConnectorError(
                        "job_lease_conflict",
                        "Another worker holds the job lease.",
                        category="conflict",
                    )
            token = uuid.uuid4().hex
            expires_at = time.monotonic() + ttl_seconds
            _write_json_atomic(
                path,
                {
                    "token": token,
                    "owner": {"kind": context.owner.kind, "id": context.owner.id},
                    "expiresAtEpoch": now_epoch + ttl_seconds,
                },
            )
            return JobLease(job_id, token, context.owner, expires_at)

    def renew(
        self,
        lease: JobLease,
        *,
        ttl_seconds: float,
        context: OperationContext,
    ) -> JobLease:
        self._check(context)
        if not math.isfinite(ttl_seconds) or ttl_seconds <= 0:
            raise ConnectorError(
                "lease_ttl_invalid",
                "A job lease needs a positive lifetime.",
                category="invalid_input",
            )
        with self._lock:
            self._verify_lease(lease, context)
            renewed = JobLease(
                lease.job_id,
                lease.token,
                lease.owner,
                time.monotonic() + ttl_seconds,
            )
            _write_json_atomic(
                self._lease_path(lease.job_id),
                {
                    "token": lease.token,
                    "owner": {"kind": lease.owner.kind, "id": lease.owner.id},
                    "expiresAtEpoch": time.time() + ttl_seconds,
                },
            )
            return renewed

    def release(self, lease: JobLease, context: OperationContext) -> None:
        self._check(context)
        with self._lock:
            self._verify_lease(lease, context)
            self._lease_path(lease.job_id).unlink()
            _sync_directory(self.leases)

    def _verify_lease(
        self,
        lease: JobLease,
        context: OperationContext,
    ) -> dict[str, Any]:
        try:
            saved = _read_object(
                self._lease_path(lease.job_id),
                code="job_lease_lost",
                message="The job lease is no longer owned by this worker.",
            )
        except ConnectorError as error:
            if error.category != "not_found":
                raise
            raise ConnectorError(
                "job_lease_lost",
                "The job lease is no longer owned by this worker.",
                category="conflict",
            ) from None
        owner = saved.get("owner", {})
        if (
            saved.get("token") != lease.token
            or owner != {"kind": lease.owner.kind, "id": lease.owner.id}
            or lease.owner != context.owner
            or saved.get("expiresAtEpoch", 0) <= time.time()
        ):
            raise ConnectorError(
                "job_lease_lost",
                "The job lease is no longer owned by this worker.",
                category="conflict",
            )
        return saved

    def _job_path(self, job_id: str) -> Path:
        return self.jobs / f"{_checked_identifier(job_id, 'job')}.json"

    def _idempotency_path(self, key: str) -> Path:
        name = hashlib.sha256(key.encode()).hexdigest()
        return self.idempotency / f"{name}.json"

    def _lease_path(self, job_id: str) -> Path:
        return self.leases / f"{_checked_identifier(job_id, 'job')}.json"

    def _cancellation_path(self, job_id: str) -> Path:
        return self.cancellations / f"{_checked_identifier(job_id, 'job')}.json"


class LocalCandidateConnector(_ScopedConnector):
    """Store immutable candidate files and the existing promotion history."""

    DESCRIPTOR = ".candidate.json"

    def __init__(self, root: Path, scope: RuntimeScope):
        super().__init__(scope)
        self.root = root
        self.candidates = root / "candidates"
        self.promotions = root / "promotions"
        self.promotion_owners = root / ".connectors" / "promotion-owners"
        self.promotion_idempotency = root / ".connectors" / "promotion-idempotency"
        for directory in (
            self.candidates,
            self.promotions,
            self.promotion_owners,
            self.promotion_idempotency,
        ):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(directory, 0o700)
        os.chmod(self.promotion_owners.parent, 0o700)
        self._lock = threading.RLock()
        self._recover_promotion()

    def put(self, candidate: Candidate, context: OperationContext) -> Candidate:
        self._check(context)
        candidate_id = _checked_identifier(candidate.id, "candidate")
        self._validate_candidate(candidate)
        target = self.candidates / candidate_id
        with self._lock:
            if target.exists():
                existing = self.get(candidate.id, context)
                if not self._candidates_equal(existing, candidate):
                    raise ConnectorError(
                        "candidate_immutable",
                        "The candidate ID already identifies different content.",
                        category="integrity",
                    )
                return existing
            staging = self.candidates / f".{candidate_id}.{uuid.uuid4().hex}"
            staging.mkdir(mode=0o700)
            try:
                names: list[dict[str, Any]] = []
                used = {self.DESCRIPTOR, "manifest.json"}
                for artifact in candidate.artifacts:
                    name = artifact.metadata.get("name", artifact.digest.value)
                    if (
                        not isinstance(name, str)
                        or Path(name).name != name
                        or name in used
                    ):
                        raise ConnectorError(
                            "candidate_artifact_name_invalid",
                            "Candidate artifact names must be unique file names.",
                            category="invalid_input",
                        )
                    used.add(name)
                    _write_immutable(staging / name, artifact.data)
                    names.append(
                        {
                            "name": name,
                            "digest": str(artifact.digest),
                            "mediaType": artifact.media_type,
                            "metadata": artifact.metadata,
                        }
                    )
                _write_immutable(
                    staging / "manifest.json",
                    _json_bytes(candidate.manifest),
                )
                _write_immutable(
                    staging / self.DESCRIPTOR,
                    _json_bytes(
                        {
                            "id": candidate.id,
                            "digest": str(candidate.digest),
                            "contentDigest": str(
                                _candidate_content_digest(
                                    candidate.manifest,
                                    candidate.artifacts,
                                )
                            ),
                            "manifestDigest": str(_digest(_json_bytes(candidate.manifest))),
                            "artifacts": names,
                        }
                    ),
                )
                os.replace(staging, target)
                _sync_directory(self.candidates)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
        return candidate

    def get(self, candidate_id: str, context: OperationContext) -> Candidate:
        self._check(context, hide=True)
        candidate_id = _checked_identifier(candidate_id, "candidate")
        directory = self.candidates / candidate_id
        if not directory.is_dir():
            raise ConnectorError(
                "candidate_not_found",
                "The candidate was not found.",
                category="not_found",
            )
        descriptor_path = directory / self.DESCRIPTOR
        with self._lock:
            if not descriptor_path.exists():
                self._migrate_existing_candidate(directory, candidate_id)
        descriptor = _read_object(
            descriptor_path,
            code="candidate_not_found",
            message="The candidate was not found.",
        )
        manifest = _read_object(
            directory / "manifest.json",
            code="candidate_not_found",
            message="The candidate was not found.",
        )
        try:
            digest = _content_digest(descriptor["digest"])
            manifest_digest = _content_digest(descriptor["manifestDigest"])
            content_digest = (
                _content_digest(descriptor["contentDigest"])
                if "contentDigest" in descriptor
                else None
            )
        except (KeyError, ValueError):
            raise ConnectorError(
                "candidate_damaged",
                "The candidate descriptor has an invalid digest.",
                category="integrity",
            ) from None
        if _digest(_json_bytes(manifest)) != manifest_digest:
            raise ConnectorError(
                "candidate_damaged",
                "The candidate manifest no longer matches its immutable identity.",
                category="integrity",
            )
        artifact_records = descriptor.get("artifacts", [])
        if not isinstance(artifact_records, list):
            raise ConnectorError(
                "candidate_damaged",
                "The candidate descriptor has invalid artifacts.",
                category="integrity",
            )
        artifacts = []
        for item in artifact_records:
            if not isinstance(item, dict):
                raise ConnectorError(
                    "candidate_damaged",
                    "The candidate descriptor has an invalid artifact.",
                    category="integrity",
                )
            try:
                name = item["name"]
                artifact_digest = _content_digest(item["digest"])
                media_type = item["mediaType"]
                metadata = item.get("metadata", {})
                if (
                    not isinstance(name, str)
                    or not isinstance(media_type, str)
                    or not isinstance(metadata, dict)
                ):
                    raise ValueError("invalid candidate artifact descriptor")
                data = (directory / name).read_bytes()
            except (KeyError, OSError, ValueError, TypeError):
                raise ConnectorError(
                    "candidate_damaged",
                    "A candidate artifact is missing or invalid.",
                    category="integrity",
                ) from None
            if Path(name).name != name or _digest(data) != artifact_digest:
                raise ConnectorError(
                    "candidate_damaged",
                    "A candidate artifact no longer matches its immutable identity.",
                    category="integrity",
                )
            artifacts.append(
                Artifact(
                    artifact_digest,
                    media_type,
                    data,
                    metadata,
                )
            )
        try:
            candidate = Candidate(
                descriptor.get("id", ""),
                digest,
                manifest,
                tuple(artifacts),
            )
        except ValueError:
            raise ConnectorError(
                "candidate_damaged",
                "The candidate descriptor is invalid.",
                category="integrity",
            ) from None
        if candidate.id != candidate_id:
            raise ConnectorError(
                "candidate_damaged",
                "The candidate descriptor names another candidate.",
                category="integrity",
            )
        if (
            content_digest is not None
            and _candidate_content_digest(candidate.manifest, candidate.artifacts)
            != content_digest
        ):
            raise ConnectorError(
                "candidate_damaged",
                "The candidate content no longer matches its immutable identity.",
                category="integrity",
            )
        self._validate_candidate(candidate)
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
        with self._lock:
            request_digest = _digest(
                _json_bytes(
                    {
                        "candidateId": candidate_id,
                        "expectedGeneration": expected_generation,
                        "operation": operation,
                        "owner": {
                            "kind": context.owner.kind,
                            "id": context.owner.id,
                        },
                        "scope": _scope_key(context.scope),
                    }
                )
            )
            idempotency_path = self._promotion_idempotency_path(
                context.idempotency_key
            )
            if idempotency_path.exists():
                saved = _read_object(
                    idempotency_path,
                    code="promotion_idempotency_not_found",
                    message="The promotion retry was not found.",
                )
                if saved.get("requestDigest") != str(request_digest):
                    raise ConnectorError(
                        "idempotency_conflict",
                        "The idempotency key was reused with different input.",
                        category="conflict",
                    )
                generation = saved.get("generation")
                if not isinstance(generation, int):
                    raise ConnectorError(
                        "promotion_idempotency_damaged",
                        "The promotion retry record is invalid.",
                        category="integrity",
                    )
                history_path = self.promotions / f"{generation:08d}.json"
                if not history_path.exists():
                    promotion_record = saved.get("promotion")
                    owner_kind = saved.get("ownerKind")
                    if not isinstance(promotion_record, dict) or not isinstance(
                        owner_kind, str
                    ):
                        raise ConnectorError(
                            "promotion_idempotency_damaged",
                            "The promotion retry record is invalid.",
                            category="integrity",
                        )
                    self._write_promotion_record(promotion_record, owner_kind)
                elif (
                    _read_object(
                        history_path,
                        code="promotion_not_found",
                        message="The promotion generation was not found.",
                    )
                    != saved.get("promotion")
                    or self._promotion_owner_kind(generation)
                    != saved.get("ownerKind")
                ):
                    raise ConnectorError(
                        "promotion_idempotency_damaged",
                        "The promotion retry does not match its immutable generation.",
                        category="integrity",
                    )
                self._recover_promotion()
                return self._promotion_from_json(
                    _read_object(
                        history_path,
                        code="promotion_not_found",
                        message="The promotion generation was not found.",
                    ),
                    self._promotion_owner_kind(generation),
                )
            self._recover_pending_promotions()
            current = self.current(context)
            generation = current.generation if current else 0
            if generation != expected_generation:
                raise ConnectorError(
                    "promotion_generation_conflict",
                    "The promotion generation changed.",
                    category="conflict",
                )
            self.get(candidate_id, context)
            promotion = Promotion(
                generation + 1,
                candidate_id,
                current.candidate_id if current else None,
                operation,
                context.owner,
            )
            saved = self._promotion_record(promotion)
            _write_immutable(
                idempotency_path,
                _json_bytes(
                    {
                        "generation": promotion.generation,
                        "requestDigest": str(request_digest),
                        "ownerKind": promotion.owner.kind,
                        "promotion": saved,
                    }
                ),
            )
            self._write_promotion_record(saved, promotion.owner.kind)
            return promotion

    def current(self, context: OperationContext) -> Promotion | None:
        check_context(context)
        if context.scope != self.scope:
            return None
        with self._lock:
            path = self.root / "promotion.json"
            if not path.is_file():
                return None
            saved = _read_object(
                path,
                code="promotion_not_found",
                message="The promotion was not found.",
            )
            generation = saved.get("generation")
            if not isinstance(generation, int):
                raise ConnectorError(
                    "promotion_damaged",
                    "The stored promotion generation is invalid.",
                    category="integrity",
                )
            promotion = self._promotion_from_json(
                saved,
                self._promotion_owner_kind(generation),
            )
            history = _read_object(
                self.promotions / f"{promotion.generation:08d}.json",
                code="promotion_not_found",
                message="The promotion generation was not found.",
            )
            if history != saved:
                raise ConnectorError(
                    "promotion_damaged",
                    "The current promotion does not match its immutable generation.",
                    category="integrity",
                )
            return promotion

    def artifact_path(
        self,
        candidate_id: str,
        name: str,
        context: OperationContext,
    ) -> Path:
        candidate = self.get(candidate_id, context)
        if not any(artifact.metadata.get("name") == name for artifact in candidate.artifacts):
            raise ConnectorError(
                "candidate_artifact_not_found",
                "The candidate artifact was not found.",
                category="not_found",
            )
        return self.candidates / candidate_id / name

    def promotion_json(
        self,
        context: OperationContext,
        *,
        generation: int | None = None,
    ) -> dict[str, Any] | None:
        self._check(context, hide=True)
        if generation is None:
            promotion = self.current(context)
            if promotion is None:
                return None
            path = self.root / "promotion.json"
        else:
            path = self.promotions / f"{generation:08d}.json"
        return _read_object(
            path,
            code="promotion_not_found",
            message="The promotion was not found.",
        )

    def recover_promotion(self, context: OperationContext) -> dict[str, Any] | None:
        self._check(context)
        with self._lock:
            before = self.current(context)
            self._recover_pending_promotions()
            after = self.current(context)
            if after is None or after == before:
                return None
            return self.promotion_json(context)

    def pending_promotions_json(
        self, context: OperationContext
    ) -> tuple[dict[str, Any], ...]:
        self._check(context)
        pending = []
        for path in self.promotion_idempotency.glob("*.json"):
            saved = _read_object(
                path,
                code="promotion_idempotency_not_found",
                message="The promotion retry was not found.",
            )
            promotion = saved.get("promotion")
            generation = saved.get("generation")
            if (
                isinstance(promotion, dict)
                and isinstance(generation, int)
                and not (self.promotions / f"{generation:08d}.json").exists()
            ):
                pending.append(promotion)
        return tuple(sorted(pending, key=lambda item: item["generation"]))

    def promotion_retry_json(
        self,
        context: OperationContext,
        *,
        expected_generation: int,
        operation: str,
    ) -> dict[str, Any] | None:
        self._check(context)
        path = self._promotion_idempotency_path(context.idempotency_key)
        if not path.exists():
            return None
        saved = _read_object(
            path,
            code="promotion_idempotency_not_found",
            message="The promotion retry was not found.",
        )
        promotion = saved.get("promotion")
        owner_kind = saved.get("ownerKind")
        if not isinstance(promotion, dict) or not isinstance(owner_kind, str):
            raise ConnectorError(
                "promotion_idempotency_damaged",
                "The promotion retry record is invalid.",
                category="integrity",
            )
        parsed = self._promotion_from_json(promotion, owner_kind)
        if (
            parsed.generation != expected_generation + 1
            or parsed.operation != operation
            or parsed.owner != context.owner
        ):
            raise ConnectorError(
                "idempotency_conflict",
                "The idempotency key was reused with different input.",
                category="conflict",
            )
        return promotion

    def _validate_candidate(self, candidate: Candidate) -> None:
        for artifact in candidate.artifacts:
            if _digest(artifact.data) != artifact.digest:
                raise ConnectorError(
                    "candidate_digest_mismatch",
                    "A candidate artifact does not match its digest.",
                    category="integrity",
                )
    @staticmethod
    def _candidates_equal(left: Candidate, right: Candidate) -> bool:
        return (
            left.id == right.id
            and left.digest == right.digest
            and left.manifest == right.manifest
            and tuple(left.artifacts) == tuple(right.artifacts)
        )

    def _promotion_record(self, promotion: Promotion) -> dict[str, Any]:
        return {
            "schemaVersion": "replica.decision-promotion/v1",
            "generation": promotion.generation,
            "candidateId": promotion.candidate_id,
            "previousCandidateId": promotion.previous_candidate_id,
            "operation": promotion.operation,
            "promotedBy": promotion.owner.id,
            "promotedAt": _timestamp(),
        }

    def _write_promotion_record(
        self, saved: Mapping[str, Any], owner_kind: str
    ) -> None:
        generation = saved.get("generation")
        if not isinstance(generation, int):
            raise ConnectorError(
                "promotion_damaged",
                "The promotion generation is invalid.",
                category="integrity",
            )
        history = self.promotions / f"{generation:08d}.json"
        data = _json_bytes(saved)
        owner_path = self.promotion_owners / f"{generation:08d}.json"
        owner_data = _json_bytes({"kind": owner_kind})
        if owner_path.exists():
            if owner_path.read_bytes() != owner_data:
                raise ConnectorError(
                    "promotion_owner_immutable",
                    "The promotion generation already identifies another owner.",
                    category="integrity",
                )
        else:
            _write_immutable(owner_path, owner_data)
        if history.exists():
            if history.read_bytes() != data:
                raise ConnectorError(
                    "promotion_generation_immutable",
                    "The promotion generation already identifies another decision.",
                    category="integrity",
                )
        else:
            _write_immutable(history, data)
        _write_json_atomic(self.root / "promotion.json", saved)

    def _recover_promotion(self) -> dict[str, Any] | None:
        history = sorted(self.promotions.glob("*.json"))
        if not history:
            return None
        latest = _read_object(
            history[-1],
            code="promotion_not_found",
            message="The promotion generation was not found.",
        )
        latest_generation = latest.get("generation")
        if not isinstance(latest_generation, int):
            raise ConnectorError(
                "promotion_damaged",
                "The latest promotion generation is invalid.",
                category="integrity",
            )
        promotion = self._promotion_from_json(
            latest,
            self._promotion_owner_kind(latest_generation),
        )
        if history[-1].name != f"{promotion.generation:08d}.json":
            raise ConnectorError(
                "promotion_damaged",
                "The latest promotion generation is invalid.",
                category="integrity",
            )
        current_path = self.root / "promotion.json"
        current = (
            _read_object(
                current_path,
                code="promotion_not_found",
                message="The promotion was not found.",
            )
            if current_path.is_file()
            else None
        )
        current_generation = current.get("generation", 0) if current else 0
        if promotion.generation == current_generation:
            return None
        if (
            promotion.generation == current_generation + 1
            and latest.get("previousCandidateId")
            == (current.get("candidateId") if current else None)
        ):
            _write_json_atomic(current_path, latest)
            return latest
        raise ConnectorError(
            "promotion_damaged",
            "Promotion history is not one generation ahead of the current pointer.",
            category="integrity",
        )

    def _recover_pending_promotions(self) -> None:
        pending: dict[int, tuple[dict[str, Any], str]] = {}
        for path in self.promotion_idempotency.glob("*.json"):
            saved = _read_object(
                path,
                code="promotion_idempotency_not_found",
                message="The promotion retry was not found.",
            )
            promotion = saved.get("promotion")
            owner_kind = saved.get("ownerKind")
            generation = saved.get("generation")
            if promotion is None and owner_kind is None:
                continue
            if (
                not isinstance(promotion, dict)
                or not isinstance(owner_kind, str)
                or not isinstance(generation, int)
                or promotion.get("generation") != generation
            ):
                raise ConnectorError(
                    "promotion_idempotency_damaged",
                    "A promotion retry record is invalid.",
                    category="integrity",
                )
            parsed = self._promotion_from_json(promotion, owner_kind)
            expected_digest = _digest(
                _json_bytes(
                    {
                        "candidateId": parsed.candidate_id,
                        "expectedGeneration": parsed.generation - 1,
                        "operation": parsed.operation,
                        "owner": {
                            "kind": parsed.owner.kind,
                            "id": parsed.owner.id,
                        },
                        "scope": _scope_key(self.scope),
                    }
                )
            )
            if saved.get("requestDigest") != str(expected_digest):
                raise ConnectorError(
                    "promotion_idempotency_damaged",
                    "A promotion retry record has invalid request identity.",
                    category="integrity",
                )
            existing = pending.get(generation)
            value = (promotion, owner_kind)
            if existing is not None and existing != value:
                raise ConnectorError(
                    "promotion_idempotency_damaged",
                    "Two promotion retries claim the same generation.",
                    category="integrity",
                )
            pending[generation] = value
        current_path = self.root / "promotion.json"
        current = (
            _read_object(
                current_path,
                code="promotion_not_found",
                message="The promotion was not found.",
            )
            if current_path.exists()
            else None
        )
        current_generation = current.get("generation", 0) if current else 0
        current_candidate = current.get("candidateId") if current else None
        for generation, (promotion, owner_kind) in sorted(pending.items()):
            history = self.promotions / f"{generation:08d}.json"
            if history.exists():
                if (
                    _read_object(
                        history,
                        code="promotion_not_found",
                        message="The promotion generation was not found.",
                    )
                    != promotion
                    or self._promotion_owner_kind(generation) != owner_kind
                ):
                    raise ConnectorError(
                        "promotion_idempotency_damaged",
                        "A promotion retry does not match its immutable generation.",
                        category="integrity",
                    )
                if generation > current_generation:
                    self._recover_promotion()
                    current_generation = generation
                    current_candidate = promotion.get("candidateId")
                continue
            if (
                generation != current_generation + 1
                or promotion.get("previousCandidateId") != current_candidate
            ):
                raise ConnectorError(
                    "promotion_idempotency_damaged",
                    "A pending promotion retry is not the next generation.",
                    category="integrity",
                )
            self._write_promotion_record(promotion, owner_kind)
            current_generation = generation
            current_candidate = promotion.get("candidateId")

    def _migrate_existing_candidate(self, directory: Path, candidate_id: str) -> None:
        manifest = _read_object(
            directory / "manifest.json",
            code="candidate_not_found",
            message="The candidate was not found.",
        )
        adapter = manifest.get("adapter", {})
        adapter_name = adapter.get("file") if isinstance(adapter, dict) else None
        names = [name for name in (adapter_name, "evaluation.json") if isinstance(name, str)]
        artifacts = []
        for name in names:
            if Path(name).name != name:
                raise ConnectorError(
                    "candidate_damaged",
                    "An existing candidate artifact has an invalid name.",
                    category="integrity",
                )
            path = directory / name
            try:
                data = path.read_bytes()
            except OSError:
                raise ConnectorError(
                    "candidate_damaged",
                    "An existing candidate artifact cannot be read.",
                    category="integrity",
                ) from None
            artifacts.append(
                {
                    "name": name,
                    "digest": str(_digest(data)),
                    "mediaType": (
                        "application/json"
                        if name.endswith(".json")
                        else "application/octet-stream"
                    ),
                    "metadata": {"name": name},
                }
            )
        if not artifacts:
            raise ConnectorError(
                "candidate_damaged",
                "The existing candidate has no artifacts.",
                category="integrity",
            )
        candidate_artifacts = tuple(
            Artifact(
                _content_digest(item["digest"]),
                item["mediaType"],
                (directory / item["name"]).read_bytes(),
                item["metadata"],
            )
            for item in artifacts
        )
        _write_immutable(
            directory / self.DESCRIPTOR,
            _json_bytes(
                {
                    "id": candidate_id,
                    "digest": str(_digest(candidate_id.encode())),
                    "contentDigest": str(
                        _candidate_content_digest(manifest, candidate_artifacts)
                    ),
                    "manifestDigest": str(_digest(_json_bytes(manifest))),
                    "artifacts": artifacts,
                }
            ),
        )

    def _promotion_owner_kind(self, generation: int) -> str:
        path = self.promotion_owners / f"{generation:08d}.json"
        if not path.exists():
            return "human"
        saved = _read_object(
            path,
            code="promotion_owner_not_found",
            message="The promotion owner was not found.",
        )
        kind = saved.get("kind")
        if kind not in ("human", "service", "worker"):
            raise ConnectorError(
                "promotion_damaged",
                "The stored promotion owner is invalid.",
                category="integrity",
            )
        return kind

    def _promotion_idempotency_path(self, key: str) -> Path:
        return self.promotion_idempotency / (
            hashlib.sha256(key.encode()).hexdigest() + ".json"
        )

    @staticmethod
    def _promotion_from_json(
        saved: Mapping[str, Any],
        owner_kind: str,
    ) -> Promotion:
        try:
            return Promotion(
                saved["generation"],
                saved["candidateId"],
                saved.get("previousCandidateId"),
                saved["operation"],
                RuntimeOwner(owner_kind, saved["promotedBy"]),
            )
        except (KeyError, TypeError, ValueError):
            raise ConnectorError(
                "promotion_damaged",
                "The stored promotion is invalid.",
                category="integrity",
            ) from None


class LocalTrainingConnector:
    """Project an existing trusted local backend onto bounded training."""

    def __init__(self, backend: Any):
        self.backend = backend
        self.name = backend.name
        self.production_eligible = backend.production_eligible
        self.supports_hard_credit_budget = bool(
            getattr(backend, "supports_hard_credit_budget", False)
        )

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        context: OperationContext,
        credential: Credential | None,
    ) -> Any:
        del credential
        check_context(context)
        if context.budget_mode == "hard" and not self.supports_hard_credit_budget:
            raise ConnectorError(
                "hard_budget_unsupported",
                "The training connector cannot enforce a hard credit budget.",
                category="invalid_input",
            )
        bounded_updates = max_updates
        if context.budget_mode == "hard":
            assert context.max_credits is not None
            bounded_updates = min(max_updates, math.floor(context.max_credits))
            if bounded_updates < 1:
                raise ConnectorError(
                    "credit_budget_too_small",
                    "The hard credit budget cannot fund one training update.",
                    category="invalid_input",
                )
        result = self.backend.train(
            taskset,
            work_directory,
            max_updates=bounded_updates,
            deadline=context.deadline,
        )
        if not isinstance(result, TrainingResult):
            return result
        credits = float(result.updates_completed)
        usage = Usage(
            operation_id=context.operation_id,
            scope=context.scope,
            connector=self.name,
            kind="training_credits",
            quantity=credits,
            unit="credits",
            cost=0.0,
            currency="USD",
            metadata={
                "updatesCompleted": result.updates_completed,
                "requestedUpdates": max_updates,
                "budgetMode": context.budget_mode,
            },
            source="local-training-connector",
        )
        return TrainingResult(
            adapter_name=result.adapter_name,
            adapter=result.adapter,
            baseline_report=result.baseline_report,
            candidate_report=result.candidate_report,
            metadata=result.metadata,
            updates_completed=result.updates_completed,
            usage=(*result.usage, usage),
        )


class LocalInferenceConnector:
    """Project an existing trusted local backend onto bounded inference."""

    def __init__(self, backend: Any):
        self.backend = backend
        self.name = backend.name

    def predict(
        self,
        adapter: Path,
        request: Mapping[str, Any],
        *,
        context: OperationContext,
        credential: Credential | None,
    ) -> Mapping[str, Any]:
        del credential
        check_context(context)
        predict_with_context = getattr(self.backend, "predict_with_context", None)
        if predict_with_context is not None:
            return predict_with_context(
                adapter,
                request,
                context=context,
                timeout_seconds=max(0.0, context.deadline - time.monotonic()),
            )
        return self.backend.predict(
            adapter,
            request,
            timeout_seconds=max(0.0, context.deadline - time.monotonic()),
        )


class LocalCredentialConnector(_ScopedConnector):
    """Mint operation-bound local credentials from a private installation key."""

    def __init__(self, root: Path, scope: RuntimeScope):
        super().__init__(scope)
        self.root = root / "credentials"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self.key_path = self.root / "local.key"
        if not self.key_path.exists():
            _write_immutable(self.key_path, os.urandom(32))
        self._key = self.key_path.read_bytes()
        if len(self._key) != 32:
            raise ConnectorError(
                "credential_key_damaged",
                "The local credential key is invalid.",
                category="integrity",
            )

    def acquire(
        self,
        audience: str,
        context: OperationContext,
    ) -> Credential:
        self._check(context)
        if not audience.strip():
            raise ConnectorError(
                "credential_audience_invalid",
                "A credential audience is required.",
                category="invalid_input",
            )
        expires_at = min(context.deadline, time.monotonic() + 60)
        message = "\0".join(
            (
                context.scope.tenant_id,
                context.scope.repository,
                context.operation_id,
                audience,
                f"{expires_at:.9f}",
            )
        ).encode()
        return Credential(
            hmac.new(self._key, message, hashlib.sha256).hexdigest(),
            expires_at,
            audience,
            context.scope,
            context.operation_id,
        )


class LocalObservabilityConnector(_ScopedConnector):
    """Append scoped usage and cost records to durable private JSON Lines."""

    def __init__(self, root: Path, scope: RuntimeScope):
        super().__init__(scope)
        self.root = root / "observability"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root, 0o700)
        self.path = self.root / "usage.jsonl"
        self._lock = threading.RLock()

    def record(self, usage: Usage, context: OperationContext) -> None:
        self._check(context)
        if usage.operation_id != context.operation_id or usage.scope != context.scope:
            raise ConnectorError(
                "usage_scope_mismatch",
                "Usage must be attributed to the current scoped operation.",
                category="invalid_input",
            )
        record = {
            "recordedAt": _timestamp(),
            "operationId": usage.operation_id,
            "scope": {
                "tenantId": usage.scope.tenant_id,
                "repository": usage.scope.repository,
            },
            "connector": usage.connector,
            "kind": usage.kind,
            "quantity": usage.quantity,
            "unit": usage.unit,
            "cost": usage.cost,
            "currency": usage.currency,
            "metadata": usage.metadata,
            "source": usage.source,
        }
        data = _json_bytes(record)
        with self._lock:
            descriptor = os.open(
                self.path,
                os.O_WRONLY | os.O_CREAT | os.O_APPEND,
                0o600,
            )
            with os.fdopen(descriptor, "ab") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())

    def records(self) -> tuple[Usage, ...]:
        if not self.path.exists():
            return ()
        events = []
        try:
            lines = self.path.read_text(encoding="utf-8").splitlines()
        except OSError:
            raise ConnectorError(
                "usage_unreadable",
                "Local usage records cannot be read.",
                category="integrity",
            ) from None
        for line in lines:
            try:
                record = json.loads(line)
                scope = record["scope"]
                events.append(
                    Usage(
                        record["operationId"],
                        RuntimeScope(scope["tenantId"], scope["repository"]),
                        record["connector"],
                        record["kind"],
                        record["quantity"],
                        record["unit"],
                        record.get("cost"),
                        record.get("currency"),
                        record.get("metadata", {}),
                        record.get("source", "connector"),
                    )
                )
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                raise ConnectorError(
                    "usage_damaged",
                    "A local usage record is invalid.",
                    category="integrity",
                ) from None
        return tuple(events)


@dataclass
class LocalConnectorBundle:
    """A composed local implementation plus lifecycle and inspection helpers."""

    connectors: RuntimeConnectors
    scope: RuntimeScope
    state_directory: Path
    taskset_reference: str | None
    taskset_digest: ContentDigest | None
    tasksets: LocalTasksetConnector
    candidates: LocalCandidateConnector
    observability: LocalObservabilityConnector
    _owner: Any

    def close(self) -> None:
        if not self._owner.closed:
            fcntl.flock(self._owner.fileno(), fcntl.LOCK_UN)
            self._owner.close()


def create_local_connector_bundle(
    state_directory: str | os.PathLike[str],
    taskset_directory: str | os.PathLike[str] | None,
    backends: Mapping[str, Any],
    *,
    scope: RuntimeScope,
    credentials: CredentialConnector | None = None,
    observability: ObservabilityConnector | None = None,
) -> LocalConnectorBundle:
    """Compose every provider-neutral responsibility for one private local runtime."""
    if fcntl is None:
        raise ConnectorError(
            "runtime_unsupported",
            "The local connector bundle needs Unix file locking.",
            category="unavailable",
        )
    if not backends:
        raise ConnectorError(
            "backend_missing",
            "Configure at least one training backend.",
            category="invalid_input",
        )
    root = Path(state_directory).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    owner = (root / ".runtime.lock").open("a+b")
    os.chmod(root / ".runtime.lock", 0o600)
    try:
        fcntl.flock(owner.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        owner.close()
        raise ConnectorError(
            "runtime_in_use",
            f"Another runtime owns {root}.",
            category="conflict",
        ) from None
    try:
        scope_path = root / ".scope.json"
        expected_scope = {
            "tenantId": scope.tenant_id,
            "repository": scope.repository,
        }
        if scope_path.exists():
            saved_scope = _read_object(
                scope_path,
                code="scope_not_found",
                message="The local runtime scope was not found.",
            )
            if saved_scope != expected_scope:
                raise ConnectorError(
                    "runtime_scope_conflict",
                    "The state directory belongs to another tenant or repository.",
                    category="conflict",
                )
        else:
            _write_immutable(scope_path, _json_bytes(expected_scope))
        tasksets = LocalTasksetConnector(root, taskset_directory, scope)
        artifacts = LocalArtifactConnector(root, scope)
        jobs = LocalJobConnector(root, scope)
        candidates = LocalCandidateConnector(root, scope)
        training = {
            name: LocalTrainingConnector(backend)
            for name, backend in backends.items()
        }
        inference = {
            name: LocalInferenceConnector(backend)
            for name, backend in backends.items()
        }
        local_credentials = LocalCredentialConnector(root, scope)
        local_observability = LocalObservabilityConnector(root, scope)
        connectors = RuntimeConnectors(
            tasksets=tasksets,
            artifacts=artifacts,
            jobs=jobs,
            candidates=candidates,
            training=training,
            inference=inference,
            credentials=credentials or local_credentials,
            observability=observability or local_observability,
        )
        return LocalConnectorBundle(
            connectors,
            scope,
            root,
            tasksets.reference,
            tasksets.digest,
            tasksets,
            candidates,
            local_observability,
            owner,
        )
    except Exception:
        fcntl.flock(owner.fileno(), fcntl.LOCK_UN)
        owner.close()
        raise


def _content_digest(value: str) -> ContentDigest:
    algorithm, separator, digest = value.partition(":")
    if not separator:
        raise ValueError("missing digest algorithm")
    return ContentDigest(algorithm, digest)


def _timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace(
        "+00:00",
        "Z",
    )
