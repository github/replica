"""Small taskset directories for tests."""

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

# A valid 1x1 PNG.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
RULE = "mem_7eb35ba21bbe6c45a9a296b4"


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def task_id(number: int) -> str:
    return f"task_{number:024x}"


def make_task(number: int, *, split: str = "train", answer: bool = False) -> dict:
    """Return a valid task with one labeled noul question about a desktop light screenshot."""
    return {
        "schemaVersion": "replica.decision-task/v1",
        "id": task_id(number),
        "split": split,
        "state": {
            "rules": [{"id": RULE, "text": "Put a visible label above every form field."}],
            "imagesNote": "Image 1 is the candidate: route / at desktop width in light theme.",
        },
        "images": [
            {
                "role": "candidate",
                "path": "images/screen.png",
                "mediaType": "image/png",
                "digest": digest(PNG),
                "size": "desktop",
                "theme": "light",
            }
        ],
        "questions": {
            RULE: {
                "type": "noul",
                "instructions": "Does the candidate follow this team learning?",
                "criteria": {"true": "It follows the learning", "false": "It breaks the learning"},
            }
        },
        "labels": {RULE: {"answer": answer}},
        "provenance": {
            "exportId": "export_test",
            "prototypeId": 13,
            "buildNumber": 5,
            "route": "/",
        },
    }


def write_taskset(case: unittest.TestCase, tasks: list) -> Path:
    """Write a taskset directory with images/screen.png. It is removed when the case ends."""
    holder = tempfile.TemporaryDirectory()
    case.addCleanup(holder.cleanup)
    directory = Path(holder.name)
    (directory / "images").mkdir()
    (directory / "images" / "screen.png").write_bytes(PNG)
    manifest = {
        "schemaVersion": "replica.decision-taskset/v1",
        "exportId": "export_test",
        "createdAt": "2026-11-07T00:00:00Z",
        "counts": {"tasks": len(tasks)},
    }
    (directory / "taskset.json").write_text(json.dumps(manifest), encoding="utf-8")
    lines = "".join(json.dumps(task) + "\n" for task in tasks)
    (directory / "tasks.jsonl").write_text(lines, encoding="utf-8")
    return directory
