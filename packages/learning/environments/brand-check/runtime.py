"""Customer-operated training, promotion, and inference for Replica decision models.

The runtime keeps orchestration separate from model code. A backend trains one bounded job,
returns an adapter and evaluation reports, and answers requests with that adapter. The local
runtime owns durable job state, immutable candidates, and the explicit promotion pointer.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import queue
import re
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol

from .connectors import (
    Artifact,
    Cancellation,
    Candidate,
    ConnectorError,
    ContentDigest,
    Credential,
    CredentialConnector,
    InferenceConnector,
    ObservabilityConnector,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
    TrainingConnector,
    Usage,
)
from .evaluate import EvaluationError, evaluate
from .local_connectors import (
    LocalConnectorBundle,
    create_local_connector_bundle,
)
from .taskset import Taskset

JOB_SCHEMA = "replica.decision-training-job/v1"
CANDIDATE_SCHEMA = "replica.decision-candidate/v1"
CANDIDATE_REPORT_SCHEMA = "replica.decision-candidate-evaluation/v1"
INFERENCE_SCHEMA = "replica.decision-evaluation-response/v1"
MIN_UPDATES = 1
MAX_UPDATES = 100_000
MIN_SECONDS = 1
MAX_SECONDS = 86_400
ENVIRONMENTS = ("development", "test", "production")
_QUESTION_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")


class RuntimeFailure(ValueError):
    """A runtime request failed. code and status are safe to return through the HTTP service."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class TrainingResult:
    """Artifacts a backend produced for one completed training job."""

    adapter_name: str
    adapter: bytes
    baseline_report: Mapping[str, Any]
    candidate_report: Mapping[str, Any]
    metadata: Mapping[str, Any]


class TrainingBackend(Protocol):
    """Compatibility seam for the single-node fixture backend."""

    name: str
    production_eligible: bool

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        deadline: float,
    ) -> TrainingResult: ...

    def predict(
        self, adapter: Path, request: Mapping[str, Any], *, timeout_seconds: float
    ) -> Mapping[str, Any]: ...


class FixtureBackend:
    """A deterministic readout for tests, demos, and operator practice without model downloads."""

    name = "fixture"
    production_eligible = False

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        deadline: float,
    ) -> TrainingResult:
        del work_directory
        counts: dict[str, list[int]] = {}
        for task in taskset.by_split["train"]:
            _check_deadline(deadline)
            for key, label in task.labels.items():
                if task.questions[key].type != "noul":
                    continue
                totals = counts.setdefault(key, [0, 0])
                totals[0] += int(bool(label))
                totals[1] += 1
        if not counts:
            raise RuntimeFailure(
                "training_data_missing",
                "The taskset's train split has no labeled yes-or-no questions.",
            )
        # Updates control how far the fixture readout moves from the released 50% baseline. Eight
        # updates fit the observed training frequency exactly, which makes the demo's gain and
        # calibration evidence easy to inspect while keeping shorter jobs meaningfully bounded.
        strength = min(1.0, max_updates / 8.0)
        probabilities = {
            key: 0.5 + strength * ((yes / total) - 0.5)
            for key, (yes, total) in sorted(counts.items())
        }
        adapter = {
            "schemaVersion": "replica.decision-fixture-readout/v1",
            "updates": max_updates,
            "probabilities": probabilities,
        }
        _check_deadline(deadline)
        baseline = _evaluate_fixture(taskset, {})
        _check_deadline(deadline)
        candidate = _evaluate_fixture(taskset, probabilities)
        _check_deadline(deadline)
        return TrainingResult(
            adapter_name="adapter.json",
            adapter=_json_bytes(adapter),
            baseline_report=baseline,
            candidate_report=candidate,
            metadata={"kind": "deterministic-fixture", "updates": max_updates},
        )

    def predict(
        self, adapter: Path, request: Mapping[str, Any], *, timeout_seconds: float
    ) -> Mapping[str, Any]:
        del timeout_seconds
        try:
            data = _read_json(adapter)
            probabilities = data["probabilities"]
        except (OSError, KeyError, ValueError, TypeError):
            raise RuntimeFailure(
                "candidate_damaged", f"Candidate adapter {adapter} is not valid fixture data.", 500
            ) from None
        return _fixture_answers(request["questions"], probabilities)


class LocalRuntime:
    """Durable local jobs, immutable candidates, one promotion pointer, and inference."""

    def __init__(
        self,
        state_directory: str | os.PathLike[str],
        taskset_directory: str | os.PathLike[str],
        backends: Mapping[str, TrainingBackend] | None = None,
        *,
        environment: str = "development",
        scope: RuntimeScope | None = None,
        credentials: CredentialConnector | None = None,
        observability: ObservabilityConnector | None = None,
    ):
        if environment not in ENVIRONMENTS:
            raise RuntimeFailure(
                "environment_invalid",
                f"Environment must be one of {', '.join(ENVIRONMENTS)}.",
            )
        self.environment = environment
        self.scope = scope or RuntimeScope("local", "local/runtime")
        self.backends = dict({"fixture": FixtureBackend()} if backends is None else backends)
        if not self.backends:
            raise RuntimeFailure("backend_missing", "Configure at least one training backend.")
        try:
            self.local_connectors: LocalConnectorBundle = create_local_connector_bundle(
                state_directory,
                taskset_directory,
                self.backends,
                scope=self.scope,
                credentials=credentials,
                observability=observability,
            )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        self.state_directory = self.local_connectors.state_directory
        self.connectors = self.local_connectors.connectors
        self.credentials = self.connectors.credentials
        self.observability = self.connectors.observability
        self.training_connectors = dict(self.connectors.training)
        self.inference_connectors = dict(self.connectors.inference)
        self._lock = threading.RLock()
        try:
            resolved = self.connectors.tasksets.resolve(
                self.local_connectors.taskset_reference,
                self._operation_context(
                    f"taskset_{uuid.uuid4().hex}",
                    max_seconds=30,
                    owner=RuntimeOwner("service", "decision-runtime"),
                ),
            )
            self.taskset = resolved.taskset
            self.taskset_digest = str(resolved.digest)
            self._executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="replica-training"
            )
            work = self.state_directory / "work"
            work.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(work, 0o700)
            self._recover_interrupted_jobs()
        except Exception:
            if hasattr(self, "_executor"):
                self._executor.shutdown(wait=False, cancel_futures=True)
            self.local_connectors.close()
            raise

    def close(self) -> None:
        """Wait for the current job and stop the worker."""
        self._executor.shutdown(wait=True, cancel_futures=True)
        self.local_connectors.close()

    def submit(
        self, *, backend: str = "fixture", max_updates: int, max_seconds: float
    ) -> dict[str, Any]:
        """Persist and enqueue one bounded job, returning its initial state."""
        _check_limits(max_updates, max_seconds)
        if backend not in self.backends:
            raise RuntimeFailure(
                "backend_unknown",
                f"Backend {json.dumps(backend)} is not configured. Choose one of "
                f"{', '.join(sorted(self.backends))}.",
            )
        job_id = f"job_{uuid.uuid4().hex}"
        job = {
            "schemaVersion": JOB_SCHEMA,
            "id": job_id,
            "state": "queued",
            "backend": backend,
            "tasksetDigest": self.taskset_digest,
            "limits": {"maxUpdates": max_updates, "maxSeconds": float(max_seconds)},
            "createdAt": _now(),
            "updatedAt": _now(),
        }
        context = self._operation_context(
            job_id,
            max_seconds=max_seconds,
            owner=RuntimeOwner("service", "decision-runtime"),
        )
        try:
            stored = dict(self.connectors.jobs.create(job_id, job, context))
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        self._executor.submit(self._run_job, job_id)
        return _public_job(stored)

    def job(self, job_id: str) -> dict[str, Any]:
        """Return one persisted job."""
        return _public_job(self._job_record(job_id))

    def _job_record(self, job_id: str) -> dict[str, Any]:
        identifier = _checked_id(job_id, "job_")
        try:
            return dict(
                self.connectors.jobs.get(
                    identifier,
                    self._operation_context(
                        f"read_{uuid.uuid4().hex}",
                        max_seconds=30,
                        owner=RuntimeOwner("service", "decision-runtime"),
                    ),
                )
            )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None

    def candidate(self, candidate_id: str) -> dict[str, Any]:
        """Return one immutable candidate manifest and evaluation report."""
        identifier = _checked_id(candidate_id, "candidate_")
        context = self._operation_context(
            f"candidate_{uuid.uuid4().hex}",
            max_seconds=30,
            owner=RuntimeOwner("service", "decision-runtime"),
        )
        try:
            candidate = self.connectors.candidates.get(identifier, context)
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        manifest = dict(candidate.manifest)
        report_artifact = next(
            (
                artifact
                for artifact in candidate.artifacts
                if artifact.metadata.get("name") == "evaluation.json"
            ),
            None,
        )
        try:
            report = json.loads(report_artifact.data) if report_artifact else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            report = None
        if not isinstance(report, dict):
            raise RuntimeFailure(
                "candidate_damaged",
                f"Candidate {candidate_id} has no valid evaluation report.",
                500,
            )
        adapter = manifest.get("adapter", {})
        adapter_file = adapter.get("file") if isinstance(adapter, dict) else None
        if (
            not isinstance(adapter, dict)
            or not isinstance(adapter_file, str)
            or Path(adapter_file).name != adapter_file
            or not isinstance(adapter.get("digest"), str)
            or manifest.get("schemaVersion") != CANDIDATE_SCHEMA
            or manifest.get("id") != candidate_id
            or manifest.get("tasksetDigest") != report.get("tasksetDigest")
            or not isinstance(manifest.get("productionEligible"), bool)
        ):
            raise RuntimeFailure(
                "candidate_damaged", f"Candidate {candidate_id} has an invalid adapter record.", 500
            )
        try:
            adapter_artifact = next(
                artifact
                for artifact in candidate.artifacts
                if artifact.metadata.get("name") == adapter_file
            )
            adapter_bytes = adapter_artifact.data
        except StopIteration:
            raise RuntimeFailure(
                "candidate_damaged", f"Candidate {candidate_id} has no readable adapter.", 500
            ) from None
        adapter_digest = "sha256:" + hashlib.sha256(adapter_bytes).hexdigest()
        manifest_identity = dict(manifest)
        manifest_identity.pop("id", None)
        expected_id = _candidate_id(manifest_identity, adapter_bytes, report)
        if adapter_digest != adapter["digest"] or expected_id != candidate_id:
            raise RuntimeFailure(
                "candidate_damaged",
                f"Candidate {candidate_id} no longer matches its immutable identity.",
                500,
            )
        return {"manifest": manifest, "evaluation": report}

    def promote(self, candidate_id: str, *, promoted_by: str) -> dict[str, Any]:
        """Explicitly make one candidate the version inference serves."""
        candidate = self._promotable_candidate(candidate_id)
        if not isinstance(promoted_by, str) or not promoted_by.strip():
            raise RuntimeFailure("invalid_input", "promotedBy must name the operator.")
        if candidate["tasksetDigest"] != self.taskset_digest:
            raise RuntimeFailure(
                "candidate_mismatch", "The candidate belongs to another taskset.", 409
            )
        with self._lock:
            current = self.promotion(required=False)
            if current and current["candidateId"] == candidate_id:
                return current
            context = self._operation_context(
                f"promote_{uuid.uuid4().hex}",
                max_seconds=30,
                owner=RuntimeOwner("human", promoted_by.strip()),
            )
            try:
                self.connectors.candidates.promote(
                    candidate_id,
                    expected_generation=current["generation"] if current else 0,
                    operation="promote",
                    context=context,
                )
                promotion = self.local_connectors.candidates.promotion_json(context)
            except ConnectorError as error:
                raise _runtime_connector_failure(error) from None
            assert promotion is not None
            return promotion

    def rollback(self, *, rolled_back_by: str) -> dict[str, Any]:
        """Promote the immediately previous candidate as a new explicit generation."""
        if not isinstance(rolled_back_by, str) or not rolled_back_by.strip():
            raise RuntimeFailure("invalid_input", "rolledBackBy must name the operator.")
        with self._lock:
            current = self.promotion()
            candidate_id = current.get("previousCandidateId")
            if not isinstance(candidate_id, str):
                raise RuntimeFailure(
                    "rollback_unavailable",
                    "The current promotion has no previous candidate to restore.",
                    409,
                )
            self._promotable_candidate(candidate_id)
            context = self._operation_context(
                f"rollback_{uuid.uuid4().hex}",
                max_seconds=30,
                owner=RuntimeOwner("human", rolled_back_by.strip()),
            )
            try:
                self.connectors.candidates.promote(
                    candidate_id,
                    expected_generation=current["generation"],
                    operation="rollback",
                    context=context,
                )
                promotion = self.local_connectors.candidates.promotion_json(context)
            except ConnectorError as error:
                raise _runtime_connector_failure(error) from None
            assert promotion is not None
            return promotion

    def promotion(self, *, required: bool = True) -> dict[str, Any] | None:
        """Return the current promotion, or fail closed when inference has no promoted model."""
        context = self._operation_context(
            f"promotion_{uuid.uuid4().hex}",
            max_seconds=30,
            owner=RuntimeOwner("service", "decision-runtime"),
        )
        try:
            promotion = self.local_connectors.candidates.promotion_json(context)
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        if promotion is None:
            if required:
                raise RuntimeFailure(
                    "candidate_not_promoted",
                    "No candidate is promoted. Promote an evaluated candidate before inference.",
                    409,
                )
            return None
        return promotion

    def ready(self) -> None:
        """Fail unless the promoted candidate is intact and its backend can serve requests."""
        promotion = self.promotion()
        self._promotable_candidate(promotion["candidateId"])

    def evaluate(
        self, request: Mapping[str, Any], *, timeout_seconds: float = 120
    ) -> dict[str, Any]:
        """Answer one prototype page with the promoted candidate."""
        _check_request(request)
        promotion = self.promotion()
        candidate_id = promotion["candidateId"]
        manifest = self._promotable_candidate(candidate_id)
        connector = self.inference_connectors.get(manifest["backend"])
        if connector is None:
            raise RuntimeFailure(
                "backend_unavailable",
                f"Promoted candidate backend {manifest['backend']} is not configured.",
                503,
            )
        context = self._operation_context(
            f"inference_{uuid.uuid4().hex}",
            max_seconds=timeout_seconds,
            owner=RuntimeOwner("service", "decision-runtime"),
        )
        try:
            adapter = self.local_connectors.candidates.artifact_path(
                candidate_id,
                manifest["adapter"]["file"],
                context,
            )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        started = time.monotonic()
        try:
            credential = self.credentials.acquire("inference", context)
            answers = dict(
                _run_inference(
                    connector,
                    adapter,
                    _backend_request(request),
                    context=context,
                    credential=credential,
                )
            )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        finally:
            try:
                self._record_usage(
                    context,
                    connector=connector.name,
                    kind="inference_seconds",
                    quantity=time.monotonic() - started,
                    unit="seconds",
                )
            except ConnectorError as error:
                raise _runtime_connector_failure(error) from None
        evaluations = []
        for key, question in request["questions"].items():
            if question.get("type") != "noul":
                continue
            probabilities = answers.get(key, {}).get("probabilities")
            if not _valid_yes_no(probabilities):
                raise RuntimeFailure(
                    "inference_failed",
                    f"The promoted candidate did not answer question {json.dumps(key)}.",
                    500,
                )
            total = probabilities.get("yes", 0) + probabilities.get("no", 0)
            yes = probabilities.get("yes", 0) / total
            answers[key] = {"probabilities": {"yes": yes, "no": 1.0 - yes}}
            evaluations.append(
                {
                    "learningId": key,
                    "followsProbability": yes,
                    "breaksProbability": 1.0 - yes,
                }
            )
        return {
            "schemaVersion": INFERENCE_SCHEMA,
            "candidateId": candidate_id,
            "promotionGeneration": promotion["generation"],
            "answers": answers,
            "evaluations": evaluations,
        }

    def _run_job(self, job_id: str) -> None:
        job = self._job_record(job_id)
        work = self.state_directory / "work" / job_id
        context: OperationContext | None = None
        connector: TrainingConnector | None = None
        lease = None
        started = time.monotonic()
        try:
            context = self._operation_context(
                job_id,
                max_seconds=job["limits"]["maxSeconds"],
                owner=RuntimeOwner("worker", "single-node-runtime"),
            )
            lease = self.connectors.jobs.acquire(
                job_id,
                ttl_seconds=job["limits"]["maxSeconds"] + 30,
                context=context,
            )
            updated = dict(job)
            updated.update(state="running", startedAt=_now(), updatedAt=_now())
            job = dict(
                self.connectors.jobs.update(
                    job_id,
                    updated,
                    expected_version=job["version"],
                    context=context,
                )
            )
            shutil.rmtree(work, ignore_errors=True)
            work.mkdir(mode=0o700)
            connector = self.training_connectors[job["backend"]]
            credential = self.credentials.acquire("training", context)
            result = _run_backend(
                connector,
                self.taskset,
                work,
                max_updates=job["limits"]["maxUpdates"],
                context=context,
                credential=credential,
            )
            self._record_usage(
                context,
                connector=connector.name,
                kind="training_updates",
                quantity=job["limits"]["maxUpdates"],
                unit="updates",
                metadata={
                    "elapsedSeconds": time.monotonic() - started,
                    "state": "succeeded",
                },
            )
            candidate_id = self._persist_candidate(job, result)
            job.update(
                state="succeeded",
                candidateId=candidate_id,
                completedAt=_now(),
                updatedAt=_now(),
            )
        except Exception as error:
            code = (
                error.code
                if isinstance(error, (RuntimeFailure, ConnectorError))
                else "backend_failed"
            )
            job.update(
                state="failed",
                error={"code": code, "message": str(error)},
                completedAt=_now(),
                updatedAt=_now(),
            )
            if context is not None and connector is not None:
                try:
                    self._record_usage(
                        context,
                        connector=connector.name,
                        kind="training_updates",
                        quantity=job["limits"]["maxUpdates"],
                        unit="updates",
                        metadata={
                            "elapsedSeconds": time.monotonic() - started,
                            "state": "failed",
                        },
                    )
                except ConnectorError as usage_error:
                    job["error"] = {
                        "code": usage_error.code,
                        "message": str(usage_error),
                    }
        finally:
            if context is not None:
                try:
                    job = dict(
                        self.connectors.jobs.update(
                            job_id,
                            job,
                            expected_version=job["version"],
                            context=self._operation_context(
                                f"finish_{job_id}",
                                max_seconds=30,
                                owner=RuntimeOwner("worker", "single-node-runtime"),
                            ),
                        )
                    )
                except ConnectorError as error:
                    if error.category != "conflict":
                        job["error"] = {"code": error.code, "message": str(error)}
            if lease is not None:
                try:
                    self.connectors.jobs.release(
                        lease,
                        self._operation_context(
                            f"release_{job_id}",
                            max_seconds=30,
                            owner=lease.owner,
                        ),
                    )
                except ConnectorError:
                    pass
            shutil.rmtree(work, ignore_errors=True)

    def _persist_candidate(self, job: Mapping[str, Any], result: TrainingResult) -> str:
        if (
            Path(result.adapter_name).name != result.adapter_name
            or result.adapter_name in ("manifest.json", "evaluation.json")
        ):
            raise RuntimeFailure(
                "backend_failed", "The backend returned an unsafe adapter file name.", 500
            )
        report = _candidate_evaluation(
            self.taskset_digest, result.baseline_report, result.candidate_report
        )
        adapter_digest = "sha256:" + hashlib.sha256(result.adapter).hexdigest()
        manifest_identity = {
            "schemaVersion": CANDIDATE_SCHEMA,
            "backend": job["backend"],
            "tasksetDigest": self.taskset_digest,
            "trainingJobId": job["id"],
            "createdAt": _now(),
            "adapter": {
                "file": result.adapter_name,
                "digest": adapter_digest,
                "bytes": len(result.adapter),
            },
            "productionEligible": bool(
                self.backends[job["backend"]].production_eligible
            ),
            "metadata": dict(result.metadata),
        }
        candidate_id = _candidate_id(manifest_identity, result.adapter, report)
        manifest = {"id": candidate_id, **manifest_identity}
        try:
            self.connectors.candidates.put(
                Candidate(
                    candidate_id,
                    ContentDigest(
                        "sha256",
                        hashlib.sha256(
                            _json_bytes(manifest)
                            + b"\0"
                            + result.adapter
                            + _json_bytes(report)
                        ).hexdigest(),
                    ),
                    manifest,
                    (
                        Artifact(
                            ContentDigest(
                                "sha256",
                                hashlib.sha256(result.adapter).hexdigest(),
                            ),
                            "application/json"
                            if result.adapter_name.endswith(".json")
                            else "application/octet-stream",
                            result.adapter,
                            {"name": result.adapter_name},
                        ),
                        Artifact(
                            ContentDigest(
                                "sha256",
                                hashlib.sha256(_json_bytes(report)).hexdigest(),
                            ),
                            "application/json",
                            _json_bytes(report),
                            {"name": "evaluation.json"},
                        ),
                    ),
                ),
                self._operation_context(
                    f"candidate_{job['id']}",
                    max_seconds=30,
                    owner=RuntimeOwner("worker", "single-node-runtime"),
                ),
            )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None
        return candidate_id

    def _recover_interrupted_jobs(self) -> None:
        context = self._operation_context(
            f"recovery_{uuid.uuid4().hex}",
            max_seconds=30,
            owner=RuntimeOwner("service", "decision-runtime"),
        )
        try:
            jobs = self.connectors.jobs.list(("queued", "running"), context)
            for existing in jobs:
                job = dict(existing)
                job.update(
                    state="failed",
                    error={
                        "code": "runtime_restarted",
                        "message": "The runtime stopped before this job completed. Submit it again.",
                    },
                    completedAt=_now(),
                    updatedAt=_now(),
                )
                self.connectors.jobs.update(
                    job["id"],
                    job,
                    expected_version=existing["version"],
                    context=context,
                )
        except ConnectorError as error:
            raise _runtime_connector_failure(error) from None

    def _promotable_candidate(self, candidate_id: str) -> dict[str, Any]:
        candidate = self.candidate(candidate_id)["manifest"]
        if candidate["tasksetDigest"] != self.taskset_digest:
            raise RuntimeFailure(
                "candidate_mismatch", "The candidate belongs to another taskset.", 409
            )
        backend = self.backends.get(candidate["backend"])
        if backend is None:
            raise RuntimeFailure(
                "backend_unavailable",
                f"Candidate backend {candidate['backend']} is not configured.",
                503,
            )
        if self.environment == "production" and not candidate.get("productionEligible"):
            raise RuntimeFailure(
                "candidate_not_production_eligible",
                f"Backend {candidate['backend']} produces development and test candidates only.",
                409,
            )
        return candidate

    def _operation_context(
        self,
        operation_id: str,
        *,
        max_seconds: float,
        owner: RuntimeOwner,
    ) -> OperationContext:
        return OperationContext(
            operation_id=operation_id,
            idempotency_key=operation_id,
            scope=self.scope,
            owner=owner,
            deadline=time.monotonic() + max_seconds,
            cancellation=Cancellation(),
        )

    def _record_usage(
        self,
        context: OperationContext,
        *,
        connector: str,
        kind: str,
        quantity: float,
        unit: str,
        metadata: Mapping[str, Any] | None = None,
    ) -> None:
        reporting_context = OperationContext(
            operation_id=context.operation_id,
            idempotency_key=context.idempotency_key,
            scope=context.scope,
            owner=context.owner,
            deadline=time.monotonic() + 30,
            cancellation=Cancellation(),
        )
        self.observability.record(
            Usage(
                operation_id=context.operation_id,
                scope=context.scope,
                connector=connector,
                kind=kind,
                quantity=quantity,
                unit=unit,
                metadata=metadata or {},
            ),
            reporting_context,
        )

def _public_job(job: Mapping[str, Any]) -> dict[str, Any]:
    public = dict(job)
    public.pop("version", None)
    return public


def _candidate_evaluation(
    taskset_digest: str,
    baseline: Mapping[str, Any],
    candidate: Mapping[str, Any],
) -> dict[str, Any]:
    base_reward = baseline.get("meanReward")
    candidate_reward = candidate.get("meanReward")
    if not isinstance(base_reward, (int, float)) or not isinstance(candidate_reward, (int, float)):
        raise RuntimeFailure(
            "evaluation_failed", "Baseline and candidate reports need numeric meanReward.", 500
        )
    base_ece = baseline.get("noul", {}).get("ece")
    candidate_ece = candidate.get("noul", {}).get("ece")
    ece_delta = (
        candidate_ece - base_ece
        if isinstance(base_ece, (int, float)) and isinstance(candidate_ece, (int, float))
        else None
    )
    return {
        "schemaVersion": CANDIDATE_REPORT_SCHEMA,
        "tasksetDigest": taskset_digest,
        "split": candidate.get("split", "test"),
        "baseline": dict(baseline),
        "candidate": dict(candidate),
        "evidence": {
            "meanRewardDelta": candidate_reward - base_reward,
            "improvesMeanReward": candidate_reward > base_reward,
            "calibrationErrorDelta": ece_delta,
            "calibrationNotWorse": ece_delta is None or ece_delta <= 0,
        },
    }


def _candidate_id(
    manifest: Mapping[str, Any],
    adapter: bytes,
    report: Mapping[str, Any],
) -> str:
    identity = hashlib.sha256()
    identity.update(_json_bytes(manifest))
    identity.update(b"\0")
    identity.update(adapter)
    identity.update(_json_bytes(report))
    return f"candidate_{identity.hexdigest()[:32]}"


def _evaluate_fixture(taskset: Taskset, probabilities: Mapping[str, float]) -> dict[str, Any]:
    split = "test"
    predictions = {
        task.id: _fixture_answers(
            {key: question.spec for key, question in task.questions.items()}, probabilities
        )
        for task in taskset.by_split[split]
    }
    try:
        return evaluate(taskset, predictions, split)
    except EvaluationError as error:
        raise RuntimeFailure("evaluation_failed", str(error)) from None


def _fixture_answers(
    questions: Mapping[str, Any], probabilities: Mapping[str, float]
) -> dict[str, Any]:
    answers = {}
    for key, question in questions.items():
        if question["type"] == "noul":
            yes = float(probabilities.get(key, 0.5))
            answers[key] = {"probabilities": {"yes": yes, "no": 1.0 - yes}}
        else:
            if question["type"] == "choice":
                criteria = question["criteria"]
                options = tuple(criteria if isinstance(criteria, list) else criteria.keys())
            else:
                criteria = question["criteria"]
                levels = criteria if isinstance(criteria, int) else len(criteria)
                options = tuple(str(level) for level in range(levels))
            answers[key] = {"probabilities": {option: 1.0 / len(options) for option in options}}
    return answers


def _check_limits(max_updates: int, max_seconds: float) -> None:
    if (
        isinstance(max_updates, bool)
        or not isinstance(max_updates, int)
        or not MIN_UPDATES <= max_updates <= MAX_UPDATES
    ):
        raise RuntimeFailure(
            "invalid_limit", f"maxUpdates must be an integer from {MIN_UPDATES} to {MAX_UPDATES}."
        )
    if (
        isinstance(max_seconds, bool)
        or not isinstance(max_seconds, (int, float))
        or not math.isfinite(max_seconds)
        or not MIN_SECONDS <= max_seconds <= MAX_SECONDS
    ):
        raise RuntimeFailure(
            "invalid_limit", f"maxSeconds must be from {MIN_SECONDS} to {MAX_SECONDS}."
        )


def _check_request(request: Mapping[str, Any]) -> None:
    if not isinstance(request, Mapping):
        raise RuntimeFailure("invalid_input", "The evaluation request must be an object.")
    if not isinstance(request.get("state"), Mapping):
        raise RuntimeFailure("invalid_input", "The evaluation request state must be an object.")
    images = request.get("images")
    if not isinstance(images, list) or not images or not all(
        isinstance(image, str) and image.startswith("data:image/") for image in images
    ):
        raise RuntimeFailure(
            "invalid_input", "The evaluation request images must be image data URIs."
        )
    questions = request.get("questions")
    if not isinstance(questions, Mapping) or not questions:
        raise RuntimeFailure(
            "invalid_input", "The evaluation request questions must be a non-empty object."
        )
    has_noul = False
    for key, question in questions.items():
        if not isinstance(key, str) or not _QUESTION_KEY.fullmatch(key):
            raise RuntimeFailure("invalid_input", "Each question needs a valid key.")
        if not isinstance(question, Mapping):
            raise RuntimeFailure("invalid_input", f"Question {key} must be an object.")
        unknown = set(question) - {"type", "instructions", "criteria", "learning_text"}
        if unknown:
            raise RuntimeFailure("invalid_input", f"Question {key} has unknown fields.")
        kind = question.get("type")
        instructions = question.get("instructions")
        criteria = question.get("criteria")
        if (
            kind not in ("noul", "choice", "score")
            or not isinstance(instructions, str)
            or not instructions.strip()
        ):
            raise RuntimeFailure("invalid_input", f"Question {key} is not valid.")
        if "learning_text" in question and (
            kind != "noul"
            or not isinstance(question["learning_text"], str)
            or not question["learning_text"].strip()
        ):
            raise RuntimeFailure("invalid_input", f"Question {key} has invalid learning text.")
        if kind == "noul":
            has_noul = True
            if "criteria" in question and not (
                isinstance(criteria, Mapping)
                and set(criteria) <= {"true", "false"}
                and all(isinstance(text, str) for text in criteria.values())
            ):
                raise RuntimeFailure("invalid_input", f"Question {key} has invalid criteria.")
        elif kind == "choice":
            if not isinstance(criteria, Mapping) or not 2 <= len(criteria) <= 255:
                raise RuntimeFailure("invalid_input", f"Question {key} needs 2 to 255 options.")
            if any(
                not isinstance(option, str)
                or not _QUESTION_KEY.fullmatch(option)
                or not isinstance(text, str)
                for option, text in criteria.items()
            ):
                raise RuntimeFailure("invalid_input", f"Question {key} has invalid options.")
        elif not (
            isinstance(criteria, list)
            and 2 <= len(criteria) <= 10
            and all(isinstance(level, str) for level in criteria)
        ):
            raise RuntimeFailure("invalid_input", f"Question {key} needs 2 to 10 score levels.")
    if not has_noul:
        raise RuntimeFailure(
            "invalid_input", "The evaluation request needs at least one yes-or-no question."
        )


def _valid_yes_no(value: Any) -> bool:
    if not isinstance(value, Mapping) or any(key not in ("yes", "no") for key in value):
        return False
    yes, no = value.get("yes", 0), value.get("no", 0)
    return (
        not isinstance(yes, bool)
        and not isinstance(no, bool)
        and isinstance(yes, (int, float))
        and isinstance(no, (int, float))
        and math.isfinite(yes)
        and math.isfinite(no)
        and 0 <= yes <= 1
        and 0 <= no <= 1
        and abs(yes + no - 1) <= 0.001
        and yes + no > 0
    )


def _backend_request(request: Mapping[str, Any]) -> dict[str, Any]:
    """Project validated input to the data-only contract the local fixture backend needs.

    Free-form state, instructions, learning text, and option descriptions remain outside backend
    execution. A later model backend must define and secure its own text-bearing input contract.
    """
    return {
        "images": list(request["images"]),
        "questions": {
            key: (
                {"type": "noul"}
                if question["type"] == "noul"
                else {
                    "type": question["type"],
                    "criteria": (
                        list(question["criteria"])
                        if question["type"] == "choice"
                        else len(question["criteria"])
                    ),
                }
            )
            for key, question in request["questions"].items()
        },
    }


def _checked_id(value: str, prefix: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith(prefix)
        or not value[len(prefix) :].isalnum()
    ):
        raise RuntimeFailure("invalid_input", f"The id must start with {prefix}.")
    return value


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _check_deadline(deadline: float) -> None:
    if time.monotonic() > deadline:
        raise RuntimeFailure("job_timed_out", "The bounded training job reached maxSeconds.")


def _runtime_connector_failure(error: ConnectorError) -> RuntimeFailure:
    status = {
        "invalid_input": 400,
        "unauthorized": 401,
        "not_found": 404,
        "conflict": 409,
        "cancelled": 409,
        "integrity": 500,
        "deadline_exceeded": 504,
        "unavailable": 503,
        "internal": 500,
    }[error.category]
    return RuntimeFailure(error.code, str(error), status)


def _run_backend(
    connector: TrainingConnector,
    taskset: Taskset,
    work_directory: Path,
    *,
    max_updates: int,
    context: OperationContext,
    credential: Credential | None,
) -> TrainingResult:
    """Run trusted backend code without letting it block the runtime past the job deadline."""
    completed: queue.Queue[TrainingResult | Exception] = queue.Queue(maxsize=1)
    max_seconds = max(0.0, context.deadline - time.monotonic())

    def run() -> None:
        try:
            result: TrainingResult | Exception = connector.train(
                taskset,
                work_directory,
                max_updates=max_updates,
                context=context,
                credential=credential,
            )
        except Exception as error:
            result = error
        completed.put(result)

    thread = threading.Thread(target=run, name=f"replica-{connector.name}-job", daemon=True)
    thread.start()
    try:
        result = completed.get(timeout=max_seconds)
    except queue.Empty:
        context.cancellation.cancel()
        raise RuntimeFailure("job_timed_out", "The bounded training job reached maxSeconds.") from None
    if isinstance(result, Exception):
        raise result
    _check_deadline(context.deadline)
    return result


def _run_inference(
    connector: InferenceConnector,
    adapter: Path,
    request: Mapping[str, Any],
    *,
    context: OperationContext,
    credential: Credential | None,
) -> Mapping[str, Any]:
    """Bound inference even when a connector does not return after its deadline."""
    completed: queue.Queue[Mapping[str, Any] | Exception] = queue.Queue(maxsize=1)
    timeout_seconds = max(0.0, context.deadline - time.monotonic())

    def run() -> None:
        try:
            result: Mapping[str, Any] | Exception = connector.predict(
                adapter,
                request,
                context=context,
                credential=credential,
            )
        except Exception as error:
            result = error
        completed.put(result)

    thread = threading.Thread(
        target=run,
        name=f"replica-{connector.name}-inference",
        daemon=True,
    )
    thread.start()
    try:
        result = completed.get(timeout=timeout_seconds)
    except queue.Empty:
        context.cancellation.cancel()
        raise RuntimeFailure(
            "inference_timed_out",
            "The inference operation reached its deadline.",
            504,
        ) from None
    if isinstance(result, Exception):
        raise result
    if time.monotonic() > context.deadline:
        context.cancellation.cancel()
        raise RuntimeFailure(
            "inference_timed_out",
            "The inference operation reached its deadline.",
            504,
        )
    return result
