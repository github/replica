"""Local d1-omni training and inference behind the runtime connector contracts."""

from __future__ import annotations

import copy
import importlib.util
import io
import os
import random
import time
import unicodedata
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Mapping

from .connectors import (
    ConnectorError,
    Credential,
    OperationContext,
    TrainingResult,
    check_context,
)
from .episode import Episodes
from .evaluate import evaluate
from .local_connectors import taskset_digest
from .taskset import Taskset

BASE_MODEL_ID = "LiquidAI/d1-omni-600M"
BASE_MODEL_REVISION = "02b55d7076f15129e59ab3f94783f32c4b088674"
ADAPTER_SCHEMA = "replica.decision-d1-omni-adapter/v1"
MODEL_DEPENDENCIES = ("torch", "transformers", "PIL")
MODEL_ARTIFACTS = (
    "audio.py",
    "config.json",
    "encoder.py",
    "model.safetensors",
    "modeling_d1.py",
    "prompt.py",
    "tokenizer.json",
    "tokenizer_config.json",
    "vision.py",
)
NOUL_INSTRUCTIONS = "Does this page follow the team learning in every screenshot?"
MAX_PROMPT_TEXT = 4096


class _LocalEnvironment:
    """Use the same episode and proper-scoring path as OpenEnv without a network hop."""

    def __init__(self, taskset: Taskset, project_request: Any):
        self._episodes = Episodes(taskset)
        self._project_request = project_request

    def reset(self, **options: Any) -> SimpleNamespace:
        observation = self._project_request(self._episodes.reset(**options))
        return SimpleNamespace(
            observation=SimpleNamespace(**observation)
        )

    def step(self, action: Any) -> SimpleNamespace:
        outcome = self._episodes.step(action.answers)
        observation = SimpleNamespace(
            rewards=outcome.metadata["rewards"],
            invalid=outcome.metadata["invalid"],
        )
        return SimpleNamespace(reward=outcome.reward, observation=observation)


def detect_d1_capabilities(model_directory: str | Path) -> dict[str, Any]:
    """Report dependencies, local model availability, and usable PyTorch acceleration."""
    missing = [
        dependency
        for dependency in MODEL_DEPENDENCIES
        if importlib.util.find_spec(dependency) is None
    ]
    model_path = Path(model_directory).expanduser().resolve()
    trusted_directories = {
        Path(entry).expanduser().resolve()
        for entry in os.environ.get(
            "REPLICA_TRUSTED_MODEL_DIRS",
            "",
        ).split(os.pathsep)
        if entry and Path(entry).expanduser().is_absolute()
    }
    trusted = model_path in trusted_directories
    downloaded_revision = _downloaded_model_revision(model_path)
    revision_verified = downloaded_revision == BASE_MODEL_REVISION
    missing_artifacts = [
        artifact for artifact in MODEL_ARTIFACTS if not (model_path / artifact).is_file()
    ]
    report: dict[str, Any] = {
        "backend": "d1-omni",
        "baseModel": {
            "id": BASE_MODEL_ID,
            "revision": BASE_MODEL_REVISION,
        },
        "dependencies": {
            "available": not missing,
            "missing": missing,
        },
        "modelDirectory": {
            "path": str(model_path),
            "available": model_path.is_dir(),
            "trusted": trusted,
            "revision": downloaded_revision,
            "revisionVerified": revision_verified,
            "artifactsAvailable": not missing_artifacts,
            "missingArtifacts": missing_artifacts,
        },
        "accelerator": "unavailable",
        "training": False,
        "inference": False,
        "evaluationCapable": False,
        "qualityValidated": False,
        "coldStart": "per-request",
    }
    if missing:
        report["status"] = "dependencies_unavailable"
        return report
    import torch

    if torch.cuda.is_available():
        accelerator = "cuda"
    elif torch.backends.mps.is_available():
        accelerator = "mps"
    else:
        accelerator = "cpu"
    report["accelerator"] = accelerator
    report["inference"] = (
        model_path.is_dir()
        and trusted
        and revision_verified
        and not missing_artifacts
    )
    report["training"] = (
        model_path.is_dir()
        and trusted
        and revision_verified
        and not missing_artifacts
        and accelerator in ("cuda", "mps")
    )
    report["evaluationCapable"] = report["training"]
    if not model_path.is_dir():
        report["status"] = "model_unavailable"
    elif not trusted:
        report["status"] = "model_untrusted"
    elif not revision_verified:
        report["status"] = "model_revision_unverified"
    elif missing_artifacts:
        report["status"] = "model_artifacts_missing"
    elif accelerator == "cpu":
        report["status"] = "cpu_inference_only"
    else:
        report["status"] = "ready"
    return report


class D1OmniBackend:
    """Train and serve a pinned local d1-omni base model with a small promoted adapter."""

    name = "d1-omni"
    production_eligible = True
    requires_credential = False
    max_concurrent_inference = 1

    def __init__(
        self,
        model_directory: str | Path,
        *,
        expected_taskset_digest: str,
        part: str = "readout",
        tasks_per_update: int = 16,
        group: int = 8,
        eval_every: int = 10,
        seed: int = 7,
    ):
        if part not in ("readout", "head"):
            raise ValueError("d1-omni part must be readout or head.")
        if min(tasks_per_update, group, eval_every) < 1:
            raise ValueError("d1-omni training settings must be positive.")
        self.model_directory = str(Path(model_directory).expanduser().resolve())
        self.expected_taskset_digest = expected_taskset_digest
        self.part = part
        self.tasks_per_update = tasks_per_update
        self.group = group
        self.eval_every = eval_every
        self.seed = seed

    def readiness(self) -> dict[str, Any]:
        """Return operator-safe readiness and cold-start detail without loading model weights."""
        report = detect_d1_capabilities(self.model_directory)
        report["modelDirectory"].pop("path", None)
        report["productionEligible"] = self.production_eligible
        return report

    def project_request(self, request: Mapping[str, Any]) -> dict[str, Any]:
        """Keep only the model input and retain learning text inside its data field."""
        questions = {}
        for key, question in request["questions"].items():
            question_type = question.get("type")
            projected = {"type": question_type}
            if "criteria" in question:
                projected["criteria"] = _sanitize_prompt_value(question["criteria"])
            if "learning_text" in question:
                projected["learning_text"] = _sanitize_prompt_text(
                    question["learning_text"]
                )
            if question_type == "noul":
                if not projected.get("learning_text", "").strip():
                    raise ConnectorError(
                        "learning_text_missing",
                        "Each d1-omni yes-or-no question needs non-empty learning text.",
                        category="invalid_input",
                    )
                projected["instructions"] = NOUL_INSTRUCTIONS
            questions[key] = projected
        projected_request = {
            "state": {
                "imagesNote": _sanitize_prompt_text(
                    request["state"].get("imagesNote", "")
                ),
            },
            "images": list(request["images"]),
            "questions": questions,
        }
        for member in ("task_id", "split"):
            if member in request:
                projected_request[member] = request[member]
        return projected_request

    def train_with_context(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        context: OperationContext,
        credential: Credential | None = None,
    ) -> TrainingResult:
        """Run bounded local RL and return only the adapter and evaluation evidence."""
        del credential
        operation = context
        self._check_ready(operation, training=True)
        actual_taskset_digest = str(taskset_digest(taskset))
        if actual_taskset_digest != self.expected_taskset_digest:
            raise ConnectorError(
                "taskset_scope_mismatch",
                "The configured d1-omni backend belongs to another taskset.",
                category="unauthorized",
            )
        d1 = _model_module()
        train_ids = _required_split(d1, taskset, "train", "Training")
        dev_ids = _required_split(d1, taskset, "dev", "Training")
        test_ids = _required_split(d1, taskset, "test", "Evaluation")
        try:
            d1.preflight_task_images(taskset, [*train_ids, *dev_ids, *test_ids])
        except ValueError as error:
            raise ConnectorError(
                "task_image_invalid",
                str(error),
                category="invalid_input",
            ) from None
        _validate_task_requests(
            taskset,
            [*train_ids, *dev_ids, *test_ids],
            self.project_request,
        )
        work_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        work_directory.chmod(0o700)
        started = time.monotonic()
        torch = d1.torch
        torch.manual_seed(self.seed)
        rng = random.Random(self.seed)
        environment = _LocalEnvironment(taskset, self.project_request)
        policy = d1.Policy(self.model_directory, self.part)
        baseline_predictions = _predictions(
            d1, policy, environment, test_ids, operation
        )
        baseline_report = evaluate(taskset, baseline_predictions, "test")
        if self.part == "readout":
            policy.fit_scale(environment, train_ids)
        learning_rate, decay = {
            "readout": (3e-3, 0.1),
            "head": (3e-5, 0.05),
        }[self.part]
        optimizer = torch.optim.AdamW(
            policy.parameters(),
            lr=learning_rate,
            weight_decay=decay,
        )
        best_reward, _ = _split_reward(
            d1, policy, environment, dev_ids, operation
        )
        best_state = copy.deepcopy(policy.state())
        for update in range(1, max_updates + 1):
            _check_operation(operation)
            sigma = 1.0 + (0.4 - 1.0) * (update - 1) / max(1, max_updates - 1)
            optimizer.zero_grad()
            for _ in range(self.tasks_per_update):
                _check_operation(operation)
                observation = environment.reset(
                    split="train",
                    seed=rng.randrange(2**31),
                ).observation
                features = policy.features(
                    observation.task_id,
                    observation.state,
                    observation.images,
                    observation.questions,
                )
                with torch.no_grad():
                    mean = policy.yes_logits(features)
                noise = torch.randn(
                    self.group,
                    len(features.keys),
                    device=mean.device,
                )
                yes = torch.sigmoid(mean + sigma * noise)
                rewards = []
                for sample in range(self.group):
                    _check_operation(operation)
                    if sample:
                        environment.reset(task_id=observation.task_id)
                    answers = {
                        key: {
                            "probabilities": {
                                "yes": probability,
                                "no": 1 - probability,
                            }
                        }
                        for key, probability in zip(
                            features.keys,
                            yes[sample].tolist(),
                        )
                    }
                    outcome = environment.step(
                        SimpleNamespace(answers=answers)
                    ).observation
                    rewards.append(outcome.rewards)
                labeled = [key for key in features.keys if key in rewards[0]]
                if not labeled:
                    continue
                columns = [features.keys.index(key) for key in labeled]
                reward = torch.tensor(
                    [
                        [row[key] for key in labeled]
                        for row in rewards
                    ],
                    device=mean.device,
                )
                advantage = reward - reward.mean(0, keepdim=True)
                direction = (
                    advantage * noise[:, columns]
                ).mean(0) / sigma
                surrogate = (
                    direction * policy.yes_logits(features, labeled)
                ).mean()
                (-surrogate / self.tasks_per_update).backward()
            torch.nn.utils.clip_grad_norm_(policy.parameters(), 1.0)
            optimizer.step()
            if update % self.eval_every == 0 or update == max_updates:
                dev_reward, _ = _split_reward(
                    d1,
                    policy,
                    environment,
                    dev_ids,
                    operation,
                )
                if dev_reward > best_reward:
                    best_reward = dev_reward
                    best_state = copy.deepcopy(policy.state())
        policy.load(best_state)
        candidate_predictions = _predictions(
            d1,
            policy,
            environment,
            test_ids,
            operation,
        )
        candidate_report = evaluate(taskset, candidate_predictions, "test")
        adapter = _adapter_bytes(
            torch,
            best_state,
            part=self.part,
            taskset_digest_value=actual_taskset_digest,
        )
        capabilities = self.readiness()
        return TrainingResult(
            adapter_name="adapter.pt",
            adapter=adapter,
            baseline_report=baseline_report,
            candidate_report=candidate_report,
            metadata={
                "kind": "d1-omni-local",
                "baseModel": {
                    "id": BASE_MODEL_ID,
                    "revision": BASE_MODEL_REVISION,
                },
                "part": self.part,
                "accelerator": capabilities["accelerator"],
                "elapsedSeconds": time.monotonic() - started,
                "idempotencyKey": operation.idempotency_key,
            },
            updates_completed=max_updates,
        )

    def predict_with_context(
        self,
        adapter: Path,
        request: Mapping[str, Any],
        *,
        context: OperationContext,
        timeout_seconds: float,
    ) -> Mapping[str, Any]:
        """Load the pinned base plus promoted adapter and return structured probabilities."""
        del timeout_seconds
        self._check_ready(context, training=False)
        d1 = _model_module()
        torch = d1.torch
        try:
            saved = torch.load(
                adapter,
                map_location="cpu",
                weights_only=True,
            )
        except (OSError, RuntimeError, TypeError, ValueError):
            raise ConnectorError(
                "candidate_adapter_damaged",
                "The promoted d1-omni adapter is not readable.",
                category="integrity",
            ) from None
        _validate_adapter(saved, self.expected_taskset_digest)
        _check_operation(context)
        policy = d1.Policy(self.model_directory, saved["part"])
        policy.load(saved["state"])
        _check_operation(context)
        features = policy.features(
            f"inference:{context.operation_id}",
            dict(request["state"]),
            list(request["images"]),
            dict(request["questions"]),
        )
        answers = policy.answers(features)
        for key, question in request["questions"].items():
            if key not in answers:
                answers[key] = _uniform_answer(question)
        _check_operation(context)
        return answers

    def train(
        self,
        taskset: Taskset,
        work_directory: Path,
        *,
        max_updates: int,
        deadline: float,
    ) -> TrainingResult:
        """Reject legacy training that lacks the scoped operation context."""
        del taskset, work_directory, max_updates, deadline
        raise ConnectorError(
            "operation_context_required",
            "d1-omni training requires a scoped operation context.",
            category="invalid_input",
        )

    def predict(
        self,
        adapter: Path,
        request: Mapping[str, Any],
        *,
        timeout_seconds: float,
    ) -> Mapping[str, Any]:
        """Reject legacy inference that lacks the scoped operation context."""
        del adapter, request, timeout_seconds
        raise ConnectorError(
            "operation_context_required",
            "d1-omni inference requires a scoped operation context.",
            category="invalid_input",
        )

    def _check_ready(
        self,
        context: OperationContext,
        *,
        training: bool,
    ) -> None:
        _check_operation(context)
        capability = detect_d1_capabilities(self.model_directory)
        if not capability["dependencies"]["available"]:
            missing = ", ".join(capability["dependencies"]["missing"])
            raise ConnectorError(
                "model_dependencies_unavailable",
                f"Install the d1-omni model dependencies: {missing}.",
                category="unavailable",
            )
        if not capability["modelDirectory"]["available"]:
            raise ConnectorError(
                "base_model_unavailable",
                "The pinned local d1-omni model directory is unavailable.",
                category="unavailable",
            )
        if not capability["modelDirectory"]["trusted"]:
            raise ConnectorError(
                "base_model_untrusted",
                "Review the local model code and add its absolute directory to "
                "REPLICA_TRUSTED_MODEL_DIRS.",
                category="unauthorized",
            )
        if not capability["modelDirectory"]["revisionVerified"]:
            raise ConnectorError(
                "base_model_revision_unverified",
                "Download the pinned d1-omni revision with hf download --local-dir "
                "and keep its Hugging Face metadata.",
                category="integrity",
            )
        if not capability["modelDirectory"]["artifactsAvailable"]:
            missing = ", ".join(capability["modelDirectory"]["missingArtifacts"])
            raise ConnectorError(
                "base_model_artifacts_missing",
                f"The pinned d1-omni model directory is incomplete: {missing}.",
                category="integrity",
            )
        if training and not capability["training"]:
            raise ConnectorError(
                "training_accelerator_unavailable",
                "d1-omni training needs an NVIDIA CUDA GPU or Apple silicon MPS.",
                category="unavailable",
            )


def _model_module() -> Any:
    from . import d1_omni

    return d1_omni


def _downloaded_model_revision(model_path: Path) -> str | None:
    metadata_root = model_path / ".cache" / "huggingface" / "download"
    if not metadata_root.is_dir():
        return None
    revisions = set()
    try:
        for metadata in metadata_root.rglob("*.metadata"):
            first_line = metadata.read_text(encoding="utf-8").splitlines()[0]
            if first_line:
                revisions.add(first_line)
    except (IndexError, OSError, UnicodeError):
        return None
    if len(revisions) != 1:
        return None
    return revisions.pop()


def _check_operation(context: OperationContext) -> None:
    check_context(context)


def _sanitize_prompt_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = "".join(
        character
        for character in text
        if character in ("\n", "\t") or unicodedata.category(character) != "Cc"
    )
    return text[:MAX_PROMPT_TEXT]


def _sanitize_prompt_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            _sanitize_prompt_text(key): _sanitize_prompt_value(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_sanitize_prompt_value(item) for item in value]
    return _sanitize_prompt_text(value)


def _required_split(
    d1: Any,
    taskset: Taskset,
    split: str,
    operation: str,
) -> list[str]:
    try:
        return d1.required_split(taskset, split, operation)
    except ValueError as error:
        raise ConnectorError(
            f"{split}_split_missing",
            str(error),
            category="invalid_input",
        ) from None


def _policy_observation(
    policy: Any,
    environment: _LocalEnvironment,
    task_id: str,
) -> tuple[Any, Any]:
    observation = environment.reset(task_id=task_id).observation
    features = policy.features(
        task_id,
        observation.state,
        observation.images,
        observation.questions,
    )
    return observation, features


def _validate_task_requests(
    taskset: Taskset,
    task_ids: list[str],
    project_request: Any,
) -> None:
    for task_id in task_ids:
        task = taskset.by_id[task_id]
        project_request(
            {
                "state": dict(task.state),
                "images": [],
                "questions": {
                    key: dict(question.spec)
                    for key, question in task.questions.items()
                },
            }
        )


def _completed_answers(
    answers: Mapping[str, Any],
    questions: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    completed = dict(answers)
    for key, question in questions.items():
        if key not in completed:
            completed[key] = _uniform_answer(question)
    return completed


def _predictions(
    _d1: Any,
    policy: Any,
    environment: _LocalEnvironment,
    task_ids: list[str],
    context: OperationContext,
) -> dict[str, Any]:
    predictions = {}
    for task_id in task_ids:
        _check_operation(context)
        observation, features = _policy_observation(policy, environment, task_id)
        predictions[task_id] = _completed_answers(
            policy.answers(features),
            observation.questions,
        )
    return predictions


def _split_reward(
    _d1: Any,
    policy: Any,
    environment: _LocalEnvironment,
    task_ids: list[str],
    context: OperationContext,
) -> tuple[float, dict[str, Any]]:
    total = 0.0
    predictions = {}
    for task_id in task_ids:
        _check_operation(context)
        observation, features = _policy_observation(policy, environment, task_id)
        answers = _completed_answers(
            policy.answers(features),
            observation.questions,
        )
        predictions[task_id] = answers
        total += environment.step(
            SimpleNamespace(answers=answers)
        ).reward
    return total / len(task_ids), predictions


def _adapter_bytes(
    torch: Any,
    state: Mapping[str, Any],
    *,
    part: str,
    taskset_digest_value: str,
) -> bytes:
    output = io.BytesIO()
    torch.save(
        {
            "schemaVersion": ADAPTER_SCHEMA,
            "baseModelId": BASE_MODEL_ID,
            "baseModelRevision": BASE_MODEL_REVISION,
            "tasksetDigest": taskset_digest_value,
            "part": part,
            "state": dict(state),
        },
        output,
    )
    return output.getvalue()


def _validate_adapter(
    saved: Any,
    expected_taskset_digest: str,
) -> None:
    if (
        not isinstance(saved, dict)
        or saved.get("schemaVersion") != ADAPTER_SCHEMA
        or saved.get("baseModelId") != BASE_MODEL_ID
        or saved.get("baseModelRevision") != BASE_MODEL_REVISION
        or saved.get("tasksetDigest") != expected_taskset_digest
        or saved.get("part") not in ("readout", "head")
        or not isinstance(saved.get("state"), dict)
    ):
        raise ConnectorError(
            "candidate_adapter_mismatch",
            "The promoted adapter does not match the pinned model and taskset.",
            category="integrity",
        )


def _uniform_answer(question: Mapping[str, Any]) -> dict[str, Any]:
    if question["type"] == "choice":
        criteria = question["criteria"]
        options = tuple(criteria if isinstance(criteria, list) else criteria.keys())
    elif question["type"] == "score":
        criteria = question["criteria"]
        levels = criteria if isinstance(criteria, int) else len(criteria)
        options = tuple(str(level) for level in range(levels))
    else:
        raise ConnectorError(
            "question_type_unsupported",
            "The d1-omni request contains an unsupported question type.",
            category="invalid_input",
        )
    if not options:
        raise ConnectorError(
            "question_options_missing",
            "The d1-omni request contains a question without options.",
            category="invalid_input",
        )
    probability = 1.0 / len(options)
    return {
        "probabilities": {
            option: probability
            for option in options
        }
    }
