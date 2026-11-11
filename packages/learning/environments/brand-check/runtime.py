"""Customer-operated training, promotion, and inference for Replica decision models.

The runtime keeps orchestration separate from model code. A backend trains one bounded job,
returns an adapter and evaluation reports, and answers requests with that adapter. The local
runtime owns durable job state, immutable candidates, and the explicit promotion pointer.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Protocol

from .evaluate import EvaluationError, evaluate
from .taskset import Taskset, load_taskset, question_options

JOB_SCHEMA = "replica.decision-training-job/v1"
CANDIDATE_SCHEMA = "replica.decision-candidate/v1"
CANDIDATE_REPORT_SCHEMA = "replica.decision-candidate-evaluation/v1"
PROMOTION_SCHEMA = "replica.decision-promotion/v1"
INFERENCE_SCHEMA = "replica.decision-evaluation-response/v1"
MIN_UPDATES = 1
MAX_UPDATES = 100_000
MIN_SECONDS = 1
MAX_SECONDS = 86_400


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
    """A provider-neutral trainer and inference adapter."""

    name: str

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        max_seconds: float,
    ) -> TrainingResult: ...

    def predict(
        self, adapter: Path, request: Mapping[str, Any], *, timeout_seconds: float
    ) -> Mapping[str, Any]: ...


class FixtureBackend:
    """A deterministic readout for tests, demos, and operator practice without model downloads."""

    name = "fixture"

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        max_seconds: float,
    ) -> TrainingResult:
        del work_directory, max_seconds
        counts: dict[str, list[int]] = {}
        for task in taskset.by_split["train"]:
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
        baseline = _evaluate_fixture(taskset, {})
        candidate = _evaluate_fixture(taskset, probabilities)
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


class D1OmniBackend:
    """Run the existing d1-omni trainer and predictor as a bounded subprocess backend."""

    name = "d1-omni"

    def __init__(
        self,
        model_directory: str | os.PathLike[str],
        *,
        environment_url: str = "http://127.0.0.1:8000",
        python: str = sys.executable,
    ):
        self.model_directory = Path(model_directory).resolve()
        self.environment_url = environment_url
        self.python = python
        self.script = Path(__file__).parent / "examples" / "train_d1_omni.py"

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        max_seconds: float,
    ) -> TrainingResult:
        if not self.model_directory.is_dir():
            raise RuntimeFailure(
                "model_missing",
                f"The d1 model directory {self.model_directory} does not exist.",
            )
        output = work_directory / "d1"
        output.mkdir()
        deadline = _monotonic() + max_seconds
        common = [
            self.python,
            str(self.script),
            "--model",
            str(self.model_directory),
            "--taskset",
            str(taskset.directory),
            "--out",
            str(output),
            "--url",
            self.environment_url,
        ]
        self._run(
            [common[0], common[1], "train", *common[2:], "--updates", str(max_updates)],
            deadline,
        )
        trained = output / "best.pt"
        if not trained.is_file():
            raise RuntimeFailure(
                "training_failed", "The d1 trainer completed without writing best.pt.", 500
            )
        self._run(
            [common[0], common[1], "evaluate", *common[2:], "--split", "test", "--name", "released"],
            deadline,
        )
        self._run(
            [
                common[0],
                common[1],
                "evaluate",
                *common[2:],
                "--trained",
                str(trained),
                "--split",
                "test",
                "--name",
                "trained",
            ],
            deadline,
        )
        return TrainingResult(
            adapter_name="adapter.pt",
            adapter=trained.read_bytes(),
            baseline_report=_read_json(output / "released-test-report.json"),
            candidate_report=_read_json(output / "trained-test-report.json"),
            metadata={
                "kind": "d1-omni-readout",
                "baseModel": "LiquidAI/d1-omni-600M",
                "updates": max_updates,
            },
        )

    def predict(
        self, adapter: Path, request: Mapping[str, Any], *, timeout_seconds: float
    ) -> Mapping[str, Any]:
        if not self.model_directory.is_dir():
            raise RuntimeFailure(
                "model_missing",
                f"The d1 model directory {self.model_directory} does not exist.",
                500,
            )
        with tempfile.TemporaryDirectory(prefix="replica-d1-request-") as holder:
            directory = Path(holder)
            document = dict(request)
            document["images"] = _write_request_images(directory, request["images"])
            request_file = directory / "request.json"
            request_file.write_bytes(_json_bytes(document))
            command = [
                self.python,
                str(self.script),
                "predict",
                "--model",
                str(self.model_directory),
                "--trained",
                str(adapter),
                "--request",
                str(request_file),
            ]
            completed = self._run(command, _monotonic() + timeout_seconds)
        try:
            return json.loads(completed.stdout)["answers"]
        except (json.JSONDecodeError, KeyError, TypeError):
            raise RuntimeFailure(
                "inference_failed", "The d1 predictor did not return probability answers.", 500
            ) from None

    @staticmethod
    def _run(command: list[str], deadline: float) -> subprocess.CompletedProcess[str]:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            raise RuntimeFailure("job_timed_out", "The bounded training job reached maxSeconds.")
        try:
            return subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                timeout=remaining,
                env=_backend_environment(),
            )
        except subprocess.TimeoutExpired:
            raise RuntimeFailure(
                "job_timed_out", "The bounded training job reached maxSeconds."
            ) from None
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or error.stdout or "no error output").strip()[-1000:]
            raise RuntimeFailure(
                "backend_failed", f"The d1 backend failed: {detail}", 500
            ) from None


class LocalRuntime:
    """Durable local jobs, immutable candidates, one promotion pointer, and inference."""

    def __init__(
        self,
        state_directory: str | os.PathLike[str],
        taskset_directory: str | os.PathLike[str],
        backends: Mapping[str, TrainingBackend] | None = None,
    ):
        self.state_directory = Path(state_directory).resolve()
        self.taskset = load_taskset(taskset_directory)
        self.taskset_digest = _taskset_digest(self.taskset)
        self.backends = dict(backends or {"fixture": FixtureBackend()})
        if not self.backends:
            raise RuntimeFailure("backend_missing", "Configure at least one training backend.")
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="replica-training")
        self.state_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.state_directory, 0o700)
        for name in ("jobs", "candidates", "work"):
            directory = self.state_directory / name
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(directory, 0o700)
        self._recover_interrupted_jobs()

    def close(self) -> None:
        """Wait for the current job and stop the worker."""
        self._executor.shutdown(wait=True)

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
        _write_json_atomic(self._job_path(job_id), job)
        self._executor.submit(self._run_job, job_id)
        return job

    def job(self, job_id: str) -> dict[str, Any]:
        """Return one persisted job."""
        return self._record(self._job_path(_checked_id(job_id, "job_")), "job", job_id)

    def candidate(self, candidate_id: str) -> dict[str, Any]:
        """Return one immutable candidate manifest and evaluation report."""
        identifier = _checked_id(candidate_id, "candidate_")
        directory = self.state_directory / "candidates" / identifier
        if not directory.is_dir():
            raise RuntimeFailure("candidate_not_found", f"Candidate {candidate_id} was not found.", 404)
        manifest = self._record(directory / "manifest.json", "candidate", candidate_id)
        report = self._record(directory / "evaluation.json", "candidate report", candidate_id)
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
        ):
            raise RuntimeFailure(
                "candidate_damaged", f"Candidate {candidate_id} has an invalid adapter record.", 500
            )
        try:
            adapter_bytes = (directory / adapter_file).read_bytes()
        except OSError:
            raise RuntimeFailure(
                "candidate_damaged", f"Candidate {candidate_id} has no readable adapter.", 500
            ) from None
        adapter_digest = "sha256:" + hashlib.sha256(adapter_bytes).hexdigest()
        identity = hashlib.sha256()
        identity.update(str(manifest.get("backend", "")).encode())
        identity.update(adapter_bytes)
        identity.update(_json_bytes(report))
        expected_id = f"candidate_{identity.hexdigest()[:32]}"
        if adapter_digest != adapter["digest"] or expected_id != candidate_id:
            raise RuntimeFailure(
                "candidate_damaged",
                f"Candidate {candidate_id} no longer matches its immutable identity.",
                500,
            )
        return {"manifest": manifest, "evaluation": report}

    def promote(self, candidate_id: str, *, promoted_by: str) -> dict[str, Any]:
        """Explicitly make one candidate the version inference serves."""
        candidate = self.candidate(candidate_id)["manifest"]
        if not isinstance(promoted_by, str) or not promoted_by.strip():
            raise RuntimeFailure("invalid_input", "promotedBy must name the operator.")
        if candidate["tasksetDigest"] != self.taskset_digest:
            raise RuntimeFailure(
                "candidate_mismatch", "The candidate belongs to another taskset.", 409
            )
        with self._lock:
            current = self.promotion(required=False)
            promotion = {
                "schemaVersion": PROMOTION_SCHEMA,
                "generation": (current["generation"] + 1) if current else 1,
                "candidateId": candidate_id,
                "previousCandidateId": current["candidateId"] if current else None,
                "promotedBy": promoted_by.strip(),
                "promotedAt": _now(),
            }
            _write_json_atomic(self.state_directory / "promotion.json", promotion)
            return promotion

    def promotion(self, *, required: bool = True) -> dict[str, Any] | None:
        """Return the current promotion, or fail closed when inference has no promoted model."""
        path = self.state_directory / "promotion.json"
        if not path.is_file():
            if required:
                raise RuntimeFailure(
                    "candidate_not_promoted",
                    "No candidate is promoted. Promote an evaluated candidate before inference.",
                    409,
                )
            return None
        return self._record(path, "promotion", "current")

    def evaluate(
        self, request: Mapping[str, Any], *, timeout_seconds: float = 120
    ) -> dict[str, Any]:
        """Answer one prototype page with the promoted candidate."""
        _check_request(request)
        promotion = self.promotion()
        candidate_id = promotion["candidateId"]
        manifest = self.candidate(candidate_id)["manifest"]
        backend = self.backends.get(manifest["backend"])
        if backend is None:
            raise RuntimeFailure(
                "backend_unavailable",
                f"Promoted candidate backend {manifest['backend']} is not configured.",
                503,
            )
        adapter = self.state_directory / "candidates" / candidate_id / manifest["adapter"]["file"]
        answers = dict(backend.predict(adapter, request, timeout_seconds=timeout_seconds))
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
        job = self.job(job_id)
        job.update(state="running", startedAt=_now(), updatedAt=_now())
        _write_json_atomic(self._job_path(job_id), job)
        work = self.state_directory / "work" / job_id
        shutil.rmtree(work, ignore_errors=True)
        work.mkdir(mode=0o700)
        try:
            backend = self.backends[job["backend"]]
            result = backend.train(
                self.taskset,
                work,
                max_updates=job["limits"]["maxUpdates"],
                max_seconds=job["limits"]["maxSeconds"],
            )
            candidate_id = self._persist_candidate(job, result)
            job.update(
                state="succeeded",
                candidateId=candidate_id,
                completedAt=_now(),
                updatedAt=_now(),
            )
        except Exception as error:
            code = error.code if isinstance(error, RuntimeFailure) else "backend_failed"
            job.update(
                state="failed",
                error={"code": code, "message": str(error)},
                completedAt=_now(),
                updatedAt=_now(),
            )
        finally:
            _write_json_atomic(self._job_path(job_id), job)
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
        identity = hashlib.sha256()
        identity.update(job["backend"].encode())
        identity.update(result.adapter)
        identity.update(_json_bytes(report))
        candidate_id = f"candidate_{identity.hexdigest()[:32]}"
        candidates = self.state_directory / "candidates"
        target = candidates / candidate_id
        if target.exists():
            existing = self.candidate(candidate_id)
            if existing["evaluation"] != report:
                raise RuntimeFailure(
                    "candidate_collision", f"Candidate id {candidate_id} already has other data.", 500
                )
            return candidate_id
        staging = candidates / f".{candidate_id}.{uuid.uuid4().hex}"
        staging.mkdir(mode=0o700)
        adapter_digest = "sha256:" + hashlib.sha256(result.adapter).hexdigest()
        manifest = {
            "schemaVersion": CANDIDATE_SCHEMA,
            "id": candidate_id,
            "backend": job["backend"],
            "tasksetDigest": self.taskset_digest,
            "trainingJobId": job["id"],
            "createdAt": _now(),
            "adapter": {
                "file": result.adapter_name,
                "digest": adapter_digest,
                "bytes": len(result.adapter),
            },
            "metadata": dict(result.metadata),
        }
        try:
            _write_immutable(staging / result.adapter_name, result.adapter)
            _write_immutable(staging / "evaluation.json", _json_bytes(report))
            _write_immutable(staging / "manifest.json", _json_bytes(manifest))
            os.replace(staging, target)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
        return candidate_id

    def _recover_interrupted_jobs(self) -> None:
        for path in (self.state_directory / "jobs").glob("job_*.json"):
            try:
                job = _read_json(path)
            except (OSError, ValueError):
                continue
            if job.get("state") in ("queued", "running"):
                job.update(
                    state="failed",
                    error={
                        "code": "runtime_restarted",
                        "message": "The runtime stopped before this job completed. Submit it again.",
                    },
                    completedAt=_now(),
                    updatedAt=_now(),
                )
                _write_json_atomic(path, job)

    def _record(self, path: Path, kind: str, identifier: str) -> dict[str, Any]:
        try:
            value = _read_json(path)
        except FileNotFoundError:
            raise RuntimeFailure(
                f"{kind.replace(' ', '_')}_not_found",
                f"{kind.title()} {identifier} was not found.",
                404,
            ) from None
        except (OSError, ValueError):
            raise RuntimeFailure(
                "state_damaged", f"Stored {kind} {identifier} is not valid JSON.", 500
            ) from None
        if not isinstance(value, dict):
            raise RuntimeFailure(
                "state_damaged", f"Stored {kind} {identifier} is not an object.", 500
            )
        return value

    def _job_path(self, job_id: str) -> Path:
        return self.state_directory / "jobs" / f"{job_id}.json"


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
        options = question_options(question)
        if question["type"] == "noul":
            yes = float(probabilities.get(key, 0.5))
            answers[key] = {"probabilities": {"yes": yes, "no": 1.0 - yes}}
        else:
            answers[key] = {
                "probabilities": {option: 1.0 / len(options) for option in options}
            }
    return answers


def _taskset_digest(taskset: Taskset) -> str:
    identity = {
        "manifest": dict(taskset.metadata),
        "tasks": [
            {
                "id": task.id,
                "split": task.split,
                "images": [image.digest for image in task.images],
                "questions": sorted(task.questions),
                "labels": dict(task.labels),
            }
            for task in taskset.tasks
        ],
    }
    return "sha256:" + hashlib.sha256(_json_bytes(identity)).hexdigest()


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
    if not isinstance(questions, Mapping) or not any(
        isinstance(question, Mapping) and question.get("type") == "noul"
        for question in questions.values()
    ):
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


def _write_request_images(directory: Path, images: list[str]) -> list[str]:
    paths = []
    for index, uri in enumerate(images):
        try:
            header, encoded = uri.split(",", 1)
            media_type = header.removeprefix("data:").removesuffix(";base64")
            if media_type not in ("image/png", "image/jpeg", "image/webp"):
                raise ValueError
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError):
            raise RuntimeFailure("invalid_input", f"Image {index + 1} is not a valid data URI.")
        suffix = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[media_type]
        path = directory / f"image-{index + 1}{suffix}"
        path.write_bytes(data)
        paths.append(path.name)
    return paths


def _backend_environment() -> dict[str, str]:
    environment = dict(os.environ)
    # The trainer needs REPLICA_ENV_TOKEN, but model code never needs credentials that authorize
    # runtime administration or promoted inference.
    environment.pop("REPLICA_RUNTIME_TOKEN", None)
    environment.pop("REPLICA_DECISION_KEY", None)
    return environment


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


def _write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    try:
        temporary.write_bytes(_json_bytes(value))
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _write_immutable(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _monotonic() -> float:
    import time

    return time.monotonic()
