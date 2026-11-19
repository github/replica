"""Exercise upload, training, promotion, disclosure, withdrawal, and deletion over HTTP."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from replica_brand_check.local_connectors import taskset_digest
from replica_brand_check.taskset import load_taskset

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
EXPORT_ID = "export_compose_deletion_demo"
GRANT_ID = "grant_compose_training"
RULE_ID = "mem_111111111111111111111111"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8010")
    args = parser.parse_args()
    token = os.environ["REPLICA_RUNTIME_TOKEN"]
    with tempfile.TemporaryDirectory() as temporary:
        taskset = write_taskset(Path(temporary))
        digest, upload = upload_request(taskset)
        call(
            args.url,
            token,
            "PUT",
            f"/v1/tasksets/{digest}",
            upload,
            key=f"upload-{digest}",
        )
        job = call(
            args.url,
            token,
            "POST",
            "/v1/jobs",
            {
                "backend": "fixture",
                "tasksetDigest": f"sha256:{digest}",
                "maxUpdates": 8,
                "maxSeconds": 30,
                "maxCredits": 8,
                "budgetMode": "hard",
            },
        )
        job = wait_for_job(args.url, token, job["id"])
        promotion = call(
            args.url,
            token,
            "POST",
            "/v1/promotions",
            {
                "candidateId": job["candidateId"],
                "promotedBy": "compose-demo",
                "expectedGeneration": 0,
            },
            key="promote-compose-demo",
        )
        disclosure = call(
            args.url,
            token,
            "GET",
            "/v1/runtime-copies?"
            + urllib.parse.urlencode({"exportId": EXPORT_ID, "limit": 100}),
        )
        before = call(args.url, token, "POST", "/score", evaluation_request())
        receipt = call(
            args.url,
            token,
            "POST",
            "/v1/deletions",
            {
                "selectors": {"grantId": GRANT_ID},
                "requestedBy": "compose-demo",
                "reason": "The training grant was withdrawn.",
            },
            key="delete-compose-demo",
        )
        receipt = call(
            args.url,
            token,
            "GET",
            f"/v1/deletions/{receipt['id']}",
        )
        if receipt["state"] != "completed":
            raise RuntimeError(f"Deletion did not complete: {receipt['state']}")
        refused = call_error(args.url, token, "POST", "/score", evaluation_request())
        if refused != (409, "deletion_revoked"):
            raise RuntimeError(f"Inference was not refused after deletion: {refused}")
        print(
            json.dumps(
                {
                    "uploadedTasksetDigest": f"sha256:{digest}",
                    "jobState": job["state"],
                    "promotedGeneration": promotion["generation"],
                    "disclosedCopies": len(disclosure["items"]),
                    "servedCandidateId": before["candidateId"],
                    "deletionReceiptId": receipt["id"],
                    "deletionState": receipt["state"],
                    "inferenceAfterWithdrawal": "refused",
                },
                sort_keys=True,
            )
        )


def write_taskset(directory: Path) -> Path:
    (directory / "images").mkdir()
    (directory / "images" / "screen.png").write_bytes(PNG)
    tasks = [task(1, "train", True), task(2, "train", False), task(3, "test", True)]
    manifest = {
        "schemaVersion": "replica.decision-taskset/v1",
        "exportId": EXPORT_ID,
        "createdAt": "2026-11-19T00:00:00Z",
        "provenance": {
            "exportDigest": "sha256:" + "1" * 64,
            "grantIds": [GRANT_ID],
            "purposes": ["training"],
            "reviewDigests": ["sha256:" + "2" * 64],
            "evidenceDigests": ["sha256:" + "3" * 64],
        },
        "retention": {"mode": "delete_on_withdrawal"},
        "counts": {"tasks": len(tasks)},
    }
    (directory / "taskset.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "tasks.jsonl").write_text(
        "".join(json.dumps(item) + "\n" for item in tasks),
        encoding="utf-8",
    )
    return directory


def task(number: int, split: str, answer: bool) -> dict:
    image_digest = "sha256:" + hashlib.sha256(PNG).hexdigest()
    return {
        "schemaVersion": "replica.decision-task/v1",
        "id": f"task_{number:024x}",
        "split": split,
        "state": {
            "rules": [{"id": RULE_ID, "text": "Put a visible label above every form field."}],
            "imagesNote": "Image 1 is the candidate: route / at desktop width in light theme.",
        },
        "images": [
            {
                "role": "candidate",
                "path": "images/screen.png",
                "mediaType": "image/png",
                "digest": image_digest,
                "size": "desktop",
                "theme": "light",
            }
        ],
        "questions": {
            RULE_ID: {
                "type": "noul",
                "instructions": "Does the candidate follow this team learning?",
                "criteria": {"true": "It follows", "false": "It breaks"},
            }
        },
        "labels": {RULE_ID: {"answer": answer}},
        "provenance": {
            "exportId": EXPORT_ID,
            "prototypeId": number,
            "buildNumber": 1,
            "route": "/",
        },
    }


def upload_request(directory: Path) -> tuple[str, dict]:
    loaded = load_taskset(directory)
    manifest = json.loads((directory / "taskset.json").read_text(encoding="utf-8"))
    tasks = [
        json.loads(line)
        for line in (directory / "tasks.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    return taskset_digest(loaded).value, {
        "schemaVersion": "replica.decision-taskset-upload/v1",
        "manifest": manifest,
        "tasks": tasks,
        "images": [
            {
                "path": "images/screen.png",
                "mediaType": "image/png",
                "digest": "sha256:" + hashlib.sha256(PNG).hexdigest(),
                "dataBase64": base64.b64encode(PNG).decode(),
            }
        ],
    }


def evaluation_request() -> dict:
    return {
        "state": {"imagesNote": "Image 1 is the candidate."},
        "images": ["data:image/png;base64," + base64.b64encode(PNG).decode()],
        "questions": {
            RULE_ID: {
                "type": "noul",
                "instructions": "Does the candidate follow this team learning?",
            }
        },
    }


def wait_for_job(url: str, token: str, job_id: str) -> dict:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        job = call(url, token, "GET", f"/v1/jobs/{job_id}")
        if job["state"] in ("succeeded", "failed", "cancelled"):
            if job["state"] != "succeeded":
                raise RuntimeError(f"Training job ended as {job['state']}.")
            return job
        time.sleep(0.05)
    raise RuntimeError("Training job did not finish.")


def call(
    url: str,
    token: str,
    method: str,
    path: str,
    body: dict | None = None,
    *,
    key: str | None = None,
) -> dict:
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if key is not None:
        headers["Idempotency-Key"] = key
    with urllib.request.urlopen(
        urllib.request.Request(url + path, data=data, headers=headers, method=method),
        timeout=30,
    ) as response:
        return json.load(response)


def call_error(
    url: str, token: str, method: str, path: str, body: dict
) -> tuple[int, str]:
    try:
        call(url, token, method, path, body)
    except urllib.error.HTTPError as error:
        with error:
            response = json.load(error)
        return error.code, response["error"]["code"]
    raise RuntimeError("The request unexpectedly succeeded.")


if __name__ == "__main__":
    main()
