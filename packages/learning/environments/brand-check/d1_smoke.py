"""Opt-in real-model smoke check for the local d1-omni connector."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .connectors import (
    Cancellation,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
)
from .d1_connector import D1OmniBackend, detect_d1_capabilities
from .episode import Episodes
from .local_connectors import taskset_digest
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
    if args.adapter is not None:
        answers = backend.predict_with_context(
            args.adapter,
            request,
            context=context,
            timeout_seconds=args.timeout,
        )
        mode = "promoted-adapter"
    else:
        from . import d1_omni

        policy = d1_omni.Policy(str(args.model), "readout")
        features = policy.features(
            f"smoke:{task_id}",
            request["state"],
            request["images"],
            request["questions"],
        )
        answers = policy.answers(features)
        mode = "released-model"
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


if __name__ == "__main__":
    main()
