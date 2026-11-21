"""Provider-neutral infrastructure contracts for the decision-model runtime."""

from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event
from typing import Any, Mapping, Protocol, Sequence

from .taskset import Taskset

_SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")

CONNECTOR_ERROR_CATEGORIES = (
    "invalid_input",
    "not_found",
    "conflict",
    "unauthorized",
    "integrity",
    "cancelled",
    "deadline_exceeded",
    "unavailable",
    "internal",
)


class ConnectorError(RuntimeError):
    """A stable infrastructure failure that orchestration can classify and retry safely."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        category: str,
        retryable: bool = False,
    ):
        if category not in CONNECTOR_ERROR_CATEGORIES:
            raise ValueError(f"Unknown connector error category {category!r}.")
        super().__init__(message)
        self.code = code
        self.category = category
        self.retryable = retryable


@dataclass(frozen=True)
class RuntimeScope:
    """The customer boundary every connector operation must preserve."""

    tenant_id: str
    repository: str

    def __post_init__(self) -> None:
        if not self.tenant_id.strip() or not self.repository.strip():
            raise ValueError("Runtime scope needs a tenant and repository.")


@dataclass(frozen=True)
class RuntimeOwner:
    """The person, service, or worker responsible for one lifecycle operation."""

    kind: str
    id: str

    def __post_init__(self) -> None:
        if self.kind not in ("human", "service", "worker") or not self.id.strip():
            raise ValueError("Runtime owner needs a supported kind and non-empty id.")


@dataclass(frozen=True)
class ContentDigest:
    """A content identity verified before immutable data is accepted or returned."""

    algorithm: str
    value: str

    def __post_init__(self) -> None:
        if self.algorithm != "sha256" or not _SHA256_HEX.fullmatch(self.value):
            raise ValueError("Content digest must be a SHA-256 hexadecimal value.")

    def __str__(self) -> str:
        return f"{self.algorithm}:{self.value}"


@dataclass
class Cancellation:
    """A cooperative cancellation signal shared across connector calls."""

    _event: Event = field(default_factory=Event, repr=False)

    def cancel(self) -> None:
        self._event.set()

    @property
    def requested(self) -> bool:
        return self._event.is_set()

    def raise_if_requested(self) -> None:
        if self.requested:
            raise ConnectorError(
                "operation_cancelled",
                "The operation was cancelled.",
                category="cancelled",
            )


@dataclass(frozen=True)
class OperationContext:
    """Scope, ownership, retry, deadline, and cancellation for one operation."""

    operation_id: str
    idempotency_key: str
    scope: RuntimeScope
    owner: RuntimeOwner
    deadline: float
    cancellation: Cancellation
    max_credits: float | None = None
    budget_mode: str = "none"

    def __post_init__(self) -> None:
        if (
            not self.operation_id.strip()
            or not self.idempotency_key.strip()
            or not math.isfinite(self.deadline)
            or (
                self.max_credits is not None
                and (
                    not math.isfinite(self.max_credits)
                    or self.max_credits <= 0
                )
            )
            or self.budget_mode not in ("none", "hard", "unmetered_local")
            or (self.budget_mode == "none") != (self.max_credits is None)
        ):
            raise ValueError(
                "Operation context needs operation and idempotency identifiers "
                "and valid deadline and budget limits."
            )


@dataclass(frozen=True)
class Artifact:
    """Immutable bytes stored under a caller-supplied digest."""

    digest: ContentDigest
    media_type: str
    data: bytes
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.media_type.strip() or not isinstance(self.data, bytes):
            raise ValueError("Artifact needs a media type and bytes.")


@dataclass(frozen=True)
class TasksetArtifact:
    """A validated taskset plus the immutable artifact that identifies its source."""

    reference: str
    digest: ContentDigest
    taskset: Taskset
    created: bool = field(default=False, compare=False)


@dataclass(frozen=True)
class TasksetImage:
    """One private image transferred as part of a complete taskset."""

    path: str
    media_type: str
    digest: ContentDigest
    data: bytes

    def __post_init__(self) -> None:
        if (
            not isinstance(self.path, str)
            or not self.path
            or not isinstance(self.media_type, str)
            or not self.media_type.strip()
            or not isinstance(self.data, bytes)
        ):
            raise ValueError("A taskset image needs a path, media type, digest, and bytes.")


@dataclass(frozen=True)
class TasksetBundle:
    """Provider-neutral contents needed to validate and register one taskset."""

    manifest: Mapping[str, Any]
    tasks: Sequence[Mapping[str, Any]]
    images: Sequence[TasksetImage]
    digest: ContentDigest | None = None

    def __post_init__(self) -> None:
        if not self.tasks or not self.images:
            raise ValueError("A taskset bundle needs tasks and images.")


@dataclass(frozen=True)
class JobLease:
    """Exclusive permission for one worker to advance a durable job."""

    job_id: str
    token: str
    owner: RuntimeOwner
    expires_at: float

    def __post_init__(self) -> None:
        if (
            not self.job_id.strip()
            or not self.token.strip()
            or not math.isfinite(self.expires_at)
        ):
            raise ValueError("Job lease needs an id, token, and finite expiry.")


@dataclass(frozen=True)
class Candidate:
    """An immutable candidate manifest and its content-addressed artifacts."""

    id: str
    digest: ContentDigest
    manifest: Mapping[str, Any]
    artifacts: Sequence[Artifact]

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.artifacts:
            raise ValueError("Candidate needs an id and at least one immutable artifact.")


@dataclass(frozen=True)
class Promotion:
    """One immutable generation in the promoted-model history."""

    generation: int
    candidate_id: str
    previous_candidate_id: str | None
    operation: str
    owner: RuntimeOwner

    def __post_init__(self) -> None:
        if (
            self.generation < 1
            or not self.candidate_id.strip()
            or self.operation not in ("promote", "rollback")
        ):
            raise ValueError("Promotion needs a generation, candidate, and valid operation.")


@dataclass(frozen=True)
class Credential:
    """A short-lived credential restricted to one operation and customer scope."""

    value: str = field(repr=False)
    expires_at: float
    audience: str
    scope: RuntimeScope
    operation_id: str

    def __post_init__(self) -> None:
        if (
            not self.value
            or not self.audience.strip()
            or not self.operation_id.strip()
            or not math.isfinite(self.expires_at)
        ):
            raise ValueError("Credential needs a value, audience, operation, and finite expiry.")


@dataclass(frozen=True)
class Usage:
    """Provider usage and cost attributed to one scoped operation."""

    operation_id: str
    scope: RuntimeScope
    connector: str
    kind: str
    quantity: float
    unit: str
    cost: float | None = None
    currency: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    source: str = "connector"

    def __post_init__(self) -> None:
        if (
            not self.operation_id.strip()
            or not self.connector.strip()
            or not self.kind.strip()
            or not self.unit.strip()
            or not self.source.strip()
            or not math.isfinite(self.quantity)
            or self.quantity < 0
            or (self.cost is None) != (self.currency is None)
            or (
                self.cost is not None
                and (not math.isfinite(self.cost) or self.cost < 0)
            )
        ):
            raise ValueError("Usage needs valid attribution, quantity, unit, and optional cost.")


@dataclass(frozen=True)
class TrainingResult:
    """Persistable artifacts and measured work from one completed training operation."""

    adapter_name: str
    adapter: bytes
    baseline_report: Mapping[str, Any]
    candidate_report: Mapping[str, Any]
    metadata: Mapping[str, Any]
    updates_completed: int
    usage: Sequence[Usage] = ()

    def __post_init__(self) -> None:
        if (
            Path(self.adapter_name).name != self.adapter_name
            or not self.adapter_name
            or not isinstance(self.adapter, bytes)
            or isinstance(self.updates_completed, bool)
            or not isinstance(self.updates_completed, int)
            or self.updates_completed < 0
            or not isinstance(self.usage, Sequence)
        ):
            raise ValueError(
                "Training result needs a safe adapter name, bytes, and measured updates."
            )


class TasksetConnector(Protocol):
    def register(
        self, bundle: TasksetBundle, context: OperationContext
    ) -> TasksetArtifact: ...

    def resolve(self, reference: str, context: OperationContext) -> TasksetArtifact: ...

    def delete(self, reference: str, context: OperationContext) -> bool: ...

    def list(self, context: OperationContext) -> Sequence[TasksetArtifact]: ...


class ArtifactConnector(Protocol):
    def put(self, artifact: Artifact, context: OperationContext) -> Artifact: ...

    def get(self, digest: ContentDigest, context: OperationContext) -> Artifact: ...


class JobConnector(Protocol):
    """Durable compare-and-swap job state with exclusive expiring worker leases."""

    def create(
        self, job_id: str, record: Mapping[str, Any], context: OperationContext
    ) -> Mapping[str, Any]: ...

    def get(self, job_id: str, context: OperationContext) -> Mapping[str, Any]: ...

    def list(
        self, states: Sequence[str], context: OperationContext
    ) -> Sequence[Mapping[str, Any]]: ...

    def update(
        self,
        job_id: str,
        record: Mapping[str, Any],
        *,
        expected_version: int,
        lease: JobLease,
        context: OperationContext,
    ) -> Mapping[str, Any]: ...

    def acquire(
        self, job_id: str, *, ttl_seconds: float, context: OperationContext
    ) -> JobLease: ...

    def renew(
        self, lease: JobLease, *, ttl_seconds: float, context: OperationContext
    ) -> JobLease: ...

    def release(self, lease: JobLease, context: OperationContext) -> None: ...

    def cancel(
        self,
        job_id: str,
        *,
        expected_version: int,
        context: OperationContext,
    ) -> Mapping[str, Any]: ...


class CandidateConnector(Protocol):
    """Immutable candidates plus an append-only, generation-checked promotion pointer."""

    def put(self, candidate: Candidate, context: OperationContext) -> Candidate: ...

    def get(self, candidate_id: str, context: OperationContext) -> Candidate: ...

    def promote(
        self,
        candidate_id: str,
        *,
        expected_generation: int,
        operation: str,
        context: OperationContext,
    ) -> Promotion: ...

    def current(self, context: OperationContext) -> Promotion | None: ...

    def delete(self, candidate_id: str, context: OperationContext) -> bool: ...

    def list(self, context: OperationContext) -> Sequence[Candidate]: ...


class PrivacyConnector(Protocol):
    """Content-free runtime copy inventory, revocations, and deletion receipts."""

    def put_copy(
        self, record: Mapping[str, Any], context: OperationContext
    ) -> Mapping[str, Any]: ...

    def get_copy(
        self, copy_id: str, context: OperationContext
    ) -> Mapping[str, Any]: ...

    def list_copies(
        self,
        selectors: Mapping[str, str],
        *,
        cursor: str | None,
        limit: int,
        context: OperationContext,
    ) -> tuple[Sequence[Mapping[str, Any]], str | None]: ...

    def tombstone_copy(
        self,
        copy_id: str,
        *,
        state: str,
        retention: Mapping[str, Any] | None,
        context: OperationContext,
    ) -> Mapping[str, Any]: ...

    def create_deletion(
        self, request: Mapping[str, Any], context: OperationContext
    ) -> Mapping[str, Any]: ...

    def get_deletion(
        self, deletion_id: str, context: OperationContext
    ) -> Mapping[str, Any]: ...

    def list_deletions(
        self, states: Sequence[str], context: OperationContext
    ) -> Sequence[Mapping[str, Any]]: ...

    def update_deletion(
        self,
        deletion_id: str,
        record: Mapping[str, Any],
        *,
        expected_version: int,
        context: OperationContext,
    ) -> Mapping[str, Any]: ...


class TrainingConnector(Protocol):
    name: str
    production_eligible: bool
    supports_hard_credit_budget: bool

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        context: OperationContext,
        credential: Credential | None,
    ) -> TrainingResult: ...


class InferenceConnector(Protocol):
    name: str

    def delete(self, reference: str, context: OperationContext) -> bool: ...

    def list_results(
        self, context: OperationContext
    ) -> Sequence[Mapping[str, Any]]: ...

    def predict(
        self,
        adapter: Path,
        request: Mapping[str, Any],
        *,
        context: OperationContext,
        credential: Credential | None,
    ) -> Mapping[str, Any]: ...


class CredentialConnector(Protocol):
    def acquire(
        self, audience: str, context: OperationContext
    ) -> Credential | None: ...


class ObservabilityConnector(Protocol):
    def record(self, usage: Usage, context: OperationContext) -> None: ...


@dataclass(frozen=True)
class RuntimeConnectors:
    """All replaceable infrastructure used by a customer-operated runtime."""

    tasksets: TasksetConnector
    artifacts: ArtifactConnector
    jobs: JobConnector
    candidates: CandidateConnector
    privacy: PrivacyConnector
    training: Mapping[str, TrainingConnector]
    inference: Mapping[str, InferenceConnector]
    credentials: CredentialConnector
    observability: ObservabilityConnector

    def __post_init__(self) -> None:
        if not self.training or not self.inference:
            raise ValueError("Runtime connectors need training and inference implementations.")


def check_context(context: OperationContext, *, now: float | None = None) -> None:
    """Reject cancelled or expired work before a connector causes side effects."""
    context.cancellation.raise_if_requested()
    if (time.monotonic() if now is None else now) >= context.deadline:
        raise ConnectorError(
            "deadline_exceeded",
            "The operation deadline was reached.",
            category="deadline_exceeded",
        )
