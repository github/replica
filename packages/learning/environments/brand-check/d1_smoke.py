"""Opt-in real-model smoke check for the local d1-omni connector."""

from __future__ import annotations

import argparse
import json
import os
import pickle
import tempfile
import time
import uuid
from pathlib import Path

from .connectors import (
    Cancellation,
    ConnectorError,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
)
from .d1_connector import (
    D1OmniBackend,
    _completed_answers,
    detect_d1_capabilities,
    taskset_learning_texts,
)
from .episode import Episodes
from .local_connectors import taskset_digest
from .runtime import _process_context, _stop_process
from .taskset import load_taskset


def main() -> None:
    """Load the pinned model and answer one real task without claiming quality evidence."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--taskset", required=True, type=Path)
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--task-id")
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    taskset = load_taskset(args.taskset)
    digest = str(taskset_digest(taskset))
    backend = D1OmniBackend(
        args.model,
        expected_taskset_digest=digest,
        expected_learning_texts=taskset_learning_texts(taskset),
    )
    capability = detect_d1_capabilities(args.model)
    if not capability["inference"]:
        raise SystemExit(
            "d1-omni inference is unavailable: "
            + json.dumps(capability, sort_keys=True)
        )
    episodes = Episodes(taskset)
    task_id = args.task_id
    if task_id is None:
        for split in ("test", "dev", "train"):
            if taskset.by_split[split]:
                task_id = taskset.by_split[split][0].id
                break
    if task_id is None:
        raise SystemExit("The taskset has no task to smoke-test.")
    request = episodes.reset(task_id=task_id)
    context = OperationContext(
        operation_id="d1-smoke",
        idempotency_key="d1-smoke",
        scope=RuntimeScope("local", "local/smoke"),
        owner=RuntimeOwner("human", "local-operator"),
        deadline=time.monotonic() + args.timeout,
        cancellation=Cancellation(),
    )
    started = time.monotonic()
    mode, answers = _run_smoke(
        backend,
        request,
        task_id=task_id,
        adapter=args.adapter,
        context=context,
    )
    print(
        json.dumps(
            {
                "status": "ok",
                "mode": mode,
                "taskId": task_id,
                "answers": len(answers),
                "accelerator": capability["accelerator"],
                "elapsedSeconds": time.monotonic() - started,
                "qualityValidated": False,
            },
            sort_keys=True,
        )
    )


def _run_smoke(
    backend: D1OmniBackend,
    request: dict,
    *,
    task_id: str,
    adapter: Path | None,
    context: OperationContext,
) -> tuple[str, dict]:
    """Run one smoke inference in a child that cannot outlive its deadline."""
    process_context = _process_context()
    with tempfile.TemporaryDirectory(prefix="replica-d1-smoke-") as directory:
        result_path = Path(directory) / "result.pickle"
        process = process_context.Process(
            target=_smoke_process,
            args=(
                str(result_path),
                backend,
                dict(request),
                task_id,
                str(adapter) if adapter is not None else None,
                context.operation_id,
                context.idempotency_key,
                context.scope,
                context.owner,
                context.deadline,
            ),
            name="replica-d1-smoke",
        )
        process.start()
        try:
            process.join(max(0.0, context.deadline - time.monotonic()))
            if process.is_alive():
                _stop_process(process)
                raise SystemExit("d1-omni smoke timed out before model execution completed.")
            try:
                with result_path.open("rb") as handle:
                    kind, payload = pickle.load(handle)
            except (FileNotFoundError, EOFError, OSError, pickle.UnpicklingError):
                raise SystemExit(
                    f"d1-omni smoke worker exited without a result "
                    f"(exit code {process.exitcode})."
                ) from None
            if kind == "error":
                raise SystemExit(payload)
            return payload
        finally:
            if process.is_alive():
                _stop_process(process)


def _smoke_process(
    result_path: str,
    backend: D1OmniBackend,
    request: dict,
    task_id: str,
    adapter: str | None,
    operation_id: str,
    idempotency_key: str,
    scope: RuntimeScope,
    owner: RuntimeOwner,
    deadline: float,
) -> None:
    try:
        context = OperationContext(
            operation_id=operation_id,
            idempotency_key=idempotency_key,
            scope=scope,
            owner=owner,
            deadline=deadline,
            cancellation=Cancellation(),
        )
        projected = backend.project_request(request)
        if adapter is not None:
            answers = backend.predict_with_context(
                Path(adapter),
                projected,
                context=context,
                timeout_seconds=max(0.0, deadline - time.monotonic()),
            )
            result = ("promoted-adapter", dict(answers))
        else:
            from . import d1_omni

            policy = d1_omni.Policy(backend.model_directory, "readout")
            features = policy.features(
                f"smoke:{task_id}",
                projected["state"],
                projected["images"],
                projected["questions"],
            )
            result = (
                "released-model",
                _completed_answers(
                    policy.answers(features),
                    projected["questions"],
                ),
            )
        outcome = ("ok", result)
    except ConnectorError as error:
        outcome = ("error", f"{error.code}: {error}")
    except Exception as error:
        outcome = (
            "error",
            f"{type(error).__name__}: {error}",
        )
    destination = Path(result_path)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}")
    try:
        with temporary.open("xb") as handle:
            pickle.dump(outcome, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
