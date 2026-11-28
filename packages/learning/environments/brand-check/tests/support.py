"""Small taskset directories for tests."""

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from replica_brand_check.connectors import ContentDigest, TasksetBundle, TasksetImage
from replica_brand_check.taskset import load_taskset

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
    evidence_digests = [digest(b"evidence")]
    manifest = {
        "schemaVersion": "replica.decision-taskset/v1",
        "exportId": "export_test",
        "createdAt": "2026-11-07T00:00:00Z",
        "provenance": {
            "exportDigest": digest(b"export"),
            "grantIds": ["grant_training"],
            "purposes": ["training"],
            "reviewDigests": [digest(b"review")],
            "evidenceDigests": evidence_digests,
            "evidenceDigest": digest(
                json.dumps(
                    evidence_digests,
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode()
            ),
        },
        "retention": {"mode": "delete_on_withdrawal"},
        "counts": {"tasks": len(tasks)},
    }
    (directory / "taskset.json").write_text(json.dumps(manifest), encoding="utf-8")
    lines = "".join(json.dumps(task) + "\n" for task in tasks)
    (directory / "tasks.jsonl").write_text(lines, encoding="utf-8")
    return directory


def taskset_upload(directory: Path) -> tuple[str, dict]:
    """Return the semantic digest and versioned upload document for a taskset."""
    from replica_brand_check.local_connectors import taskset_digest

    manifest = json.loads((directory / "taskset.json").read_text(encoding="utf-8"))
    tasks = [
        json.loads(line)
        for line in (directory / "tasks.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    images = {}
    for task in tasks:
        for image in task["images"]:
            path = image["path"]
            images.setdefault(
                path,
                {
                    "path": path,
                    "mediaType": image["mediaType"],
                    "digest": image["digest"],
                    "dataBase64": base64.b64encode((directory / path).read_bytes()).decode(
                        "ascii"
                    ),
                },
            )
    digest_value = taskset_digest(load_taskset(directory)).value
    return digest_value, {
        "schemaVersion": "replica.decision-taskset-upload/v1",
        "manifest": manifest,
        "tasks": tasks,
        "images": list(images.values()),
    }


def taskset_bundle(directory: Path) -> TasksetBundle:
    """Build the provider-neutral registration value from a local taskset."""
    _digest_value, upload = taskset_upload(directory)
    images = tuple(
        TasksetImage(
            path=image["path"],
            media_type=image["mediaType"],
            digest=ContentDigest("sha256", image["digest"].removeprefix("sha256:")),
            data=base64.b64decode(image["dataBase64"]),
        )
        for image in upload["images"]
    )
    return TasksetBundle(
        manifest=upload["manifest"],
        tasks=tuple(upload["tasks"]),
        images=images,
    )
