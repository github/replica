"""Run the complete local training, promotion, and inference lifecycle without a model download."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import shutil
import sys
import time
import importlib.util
from pathlib import Path

try:
    from replica_brand_check.runtime import LocalRuntime
except ModuleNotFoundError:
    root = Path(__file__).resolve().parent.parent
    spec = importlib.util.spec_from_file_location(
        "replica_brand_check", root / "__init__.py", submodule_search_locations=[str(root)]
    )
    assert spec is not None and spec.loader is not None
    package = importlib.util.module_from_spec(spec)
    sys.modules["replica_brand_check"] = package
    spec.loader.exec_module(package)
    from replica_brand_check.runtime import LocalRuntime

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
    runtime = LocalRuntime(state, taskset)
    try:
        submitted = runtime.submit(backend="fixture", max_updates=12, max_seconds=30)
        while True:
            job = runtime.job(submitted["id"])
            if job["state"] in ("succeeded", "failed"):
                break
            time.sleep(0.01)
        if job["state"] != "succeeded":
            raise RuntimeError(job["error"]["message"])
        candidate = runtime.candidate(job["candidateId"])
        promotion = runtime.promote(job["candidateId"], promoted_by="demo-operator")
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
                    "job": job,
                    "candidate": candidate,
                    "promotion": promotion,
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
