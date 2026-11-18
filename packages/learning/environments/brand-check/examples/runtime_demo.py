"""Run the complete local training, promotion, and inference lifecycle without a model download."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import shutil
import sys
import time
from pathlib import Path

try:
    from replica_brand_check.local_connectors import taskset_digest
    from replica_brand_check.runtime import FixtureBackend, LocalRuntime
    from replica_brand_check.taskset import load_taskset
except ModuleNotFoundError:
    root = Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location(
        "replica_brand_check", root / "__init__.py", submodule_search_locations=[str(root)]
    )
    assert spec is not None and spec.loader is not None
    package = importlib.util.module_from_spec(spec)
    sys.modules["replica_brand_check"] = package
    spec.loader.exec_module(package)
    from replica_brand_check.local_connectors import taskset_digest
    from replica_brand_check.runtime import FixtureBackend, LocalRuntime
    from replica_brand_check.taskset import load_taskset

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
LABELS = {
    "mem_111111111111111111111111": (
        "Put a visible label above every form field.",
        True,
    ),
    "mem_222222222222222222222222": (
        "Keep destructive actions away from the primary action.",
        False,
    ),
}


def task(number: int, split: str) -> dict:
    questions = {
        key: {
            "type": "noul",
            "instructions": "Does the candidate follow this team learning?",
            "criteria": {"true": "It follows the learning", "false": "It breaks the learning"},
        }
        for key in LABELS
    }
    return {
        "schemaVersion": "replica.decision-task/v1",
        "id": f"task_{number:024x}",
        "split": split,
        "state": {
            "rules": [{"id": key, "text": text} for key, (text, _) in LABELS.items()],
            "imagesNote": "Image 1 is the candidate: route / at desktop width in light theme.",
        },
        "images": [
            {
                "role": "candidate",
                "path": "images/screen.png",
                "mediaType": "image/png",
                "digest": "sha256:" + hashlib.sha256(PNG).hexdigest(),
                "size": "desktop",
                "theme": "light",
            }
        ],
        "questions": questions,
        "labels": {key: {"answer": answer} for key, (_, answer) in LABELS.items()},
        "provenance": {
            "exportId": "export_fixture",
            "prototypeId": number,
            "buildNumber": 1,
            "route": "/",
        },
    }


def write_taskset(directory: Path) -> None:
    directory.mkdir(parents=True)
    (directory / "images").mkdir()
    (directory / "images" / "screen.png").write_bytes(PNG)
    tasks = [
        task(1, "train"),
        task(2, "train"),
        task(3, "train"),
        task(4, "dev"),
        task(5, "test"),
        task(6, "test"),
    ]
    manifest = {
        "schemaVersion": "replica.decision-taskset/v1",
        "exportId": "export_fixture",
        "createdAt": "2026-11-10T00:00:00Z",
        "counts": {"tasks": len(tasks)},
    }
    (directory / "taskset.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "tasks.jsonl").write_text(
        "".join(json.dumps(item) + "\n" for item in tasks), encoding="utf-8"
    )


class SlowFixtureBackend(FixtureBackend):
    name = "fixture"

    def train(self, *args, **kwargs):
        time.sleep(0.25)
        return super().train(*args, **kwargs)


def upload_request(directory: Path) -> tuple[str, dict]:
    loaded = load_taskset(directory)
    tasks = [
        json.loads(line)
        for line in (directory / "tasks.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    image = directory / "images" / "screen.png"
    return taskset_digest(loaded).value, {
        "schemaVersion": "replica.decision-taskset-upload/v1",
        "manifest": dict(loaded.metadata),
        "tasks": tasks,
        "images": [
            {
                "path": "images/screen.png",
                "mediaType": "image/png",
                "digest": "sha256:" + hashlib.sha256(PNG).hexdigest(),
                "dataBase64": base64.b64encode(image.read_bytes()).decode(),
            }
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="new directory for demo data")
    args = parser.parse_args()
    if args.out.exists():
        print(f"error: {args.out} already exists; choose a new demo directory.", file=sys.stderr)
        return 1
    taskset = args.out / "taskset"
    state = args.out / "runtime"
    write_taskset(taskset)
    digest, upload = upload_request(taskset)
    runtime = LocalRuntime(state, None, backends={"fixture": SlowFixtureBackend()})
    try:
        registered = runtime.register_taskset(
            digest, upload, idempotency_key="demo-taskset-upload"
        )
        retry = runtime.register_taskset(
            digest, upload, idempotency_key="demo-taskset-upload"
        )
        running = runtime.submit(
            backend="fixture",
            max_updates=4,
            max_seconds=30,
            taskset_digest=registered["digest"],
        )
        while runtime.job(running["id"])["state"] == "queued":
            time.sleep(0.01)
        cancelled = runtime.submit(
            backend="fixture",
            max_updates=4,
            max_seconds=30,
            taskset_digest=registered["digest"],
        )
        cancellation = runtime.cancel(
            cancelled["id"], idempotency_key="demo-job-cancel"
        )
        cancellation_retry = runtime.cancel(
            cancelled["id"], idempotency_key="demo-job-cancel"
        )
        while runtime.job(running["id"])["state"] not in ("succeeded", "failed"):
            time.sleep(0.01)
        jobs = []
        for updates in (4, 8):
            submitted = runtime.submit(
                backend="fixture",
                max_updates=updates,
                max_seconds=30,
                taskset_digest=registered["digest"],
            )
            while True:
                job = runtime.job(submitted["id"])
                if job["state"] in ("succeeded", "failed"):
                    break
                time.sleep(0.01)
            if job["state"] != "succeeded":
                raise RuntimeError(job["error"]["message"])
            jobs.append(job)
        first = runtime.promote(jobs[0]["candidateId"], promoted_by="demo-operator")
        second = runtime.promote(jobs[1]["candidateId"], promoted_by="demo-operator")
        rollback = runtime.rollback(rolled_back_by="demo-operator")
        candidate = runtime.candidate(rollback["candidateId"])
        encoded = base64.b64encode(PNG).decode()
        response = runtime.evaluate(
            {
                "state": task(7, "test")["state"],
                "images": [f"data:image/png;base64,{encoded}"],
                "questions": task(7, "test")["questions"],
            }
        )
        print(
            json.dumps(
                {
                    "taskset": registered,
                    "tasksetRetry": retry,
                    "cancellation": cancellation,
                    "cancellationRetry": cancellation_retry,
                    "jobs": jobs,
                    "candidate": candidate,
                    "promotions": [first, second, rollback],
                    "evaluation": response,
                    "stateDirectory": str(state.resolve()),
                },
                indent=2,
            )
        )
    except Exception:
        shutil.rmtree(args.out, ignore_errors=True)
        raise
    finally:
        runtime.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
