"""Customer-operated training and serving through the local runtime."""

from __future__ import annotations

import base64
import json
import threading
import time
import unittest
from collections.abc import Mapping
from pathlib import Path
from urllib import error, request

from replica_brand_check.runtime import FixtureBackend, LocalRuntime
from replica_brand_check.runtime_server import RuntimeHTTPServer
from tests.support import PNG, RULE, make_task, write_taskset

TOKEN = "runtime-test-token-with-32-characters"


class FailingBackend(FixtureBackend):
    """A backend that fails after the runtime has accepted its job."""

    def train(self, *args, **kwargs):
        raise RuntimeError("deliberate backend failure")


class LocalRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.taskset_dir = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, answer=True),
                make_task(3, split="test", answer=True),
                make_task(4, split="test", answer=True),
            ],
        )
        self.state_dir = self.taskset_dir.parent / f"{self.taskset_dir.name}-state"
        self.addCleanup(self._remove_state)

    def test_trains_immutable_candidate_then_requires_promotion_to_serve_it(self):
        runtime = self._runtime()

        submitted = runtime.submit(backend="fixture", max_updates=8, max_seconds=5)
        self.assertEqual(submitted["state"], "queued")
        finished = self._wait_for_job(runtime, submitted["id"])
        self.assertEqual(finished["state"], "succeeded")
        candidate_id = finished["candidateId"]

        candidate = runtime.candidate(candidate_id)
        manifest, report = self._candidate_documents(candidate)
        self.assertEqual(manifest["id"], candidate_id)
        self.assertGreater(report["evidence"]["meanRewardDelta"], 0)
        self.assertIn("calibrationErrorDelta", report["evidence"])
        before = self._candidate_snapshot(candidate)
        candidate["manifest"]["backend"] = "tampered"
        self.assertEqual(self._candidate_snapshot(runtime.candidate(candidate_id)), before)
        for artifact in (self.state_dir / "candidates" / candidate_id).iterdir():
            self.assertEqual(artifact.stat().st_mode & 0o222, 0)

        promotion = runtime.promote(candidate_id, promoted_by="test-operator")
        self.assertEqual(promotion["candidateId"], candidate_id)
        response = runtime.evaluate(self._request())

        self.assertEqual(response["candidateId"], candidate_id)
        self.assertIn("schemaVersion", response)
        self.assertIn(RULE, response["answers"])
        self.assertEqual(response["evaluations"][0]["learningId"], RULE)
        self.assertEqual(self._candidate_snapshot(runtime.candidate(candidate_id)), before)

    def test_refuses_inference_until_a_candidate_is_explicitly_promoted(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=2, max_seconds=5)["id"],
        )
        self.assertEqual(finished["state"], "succeeded")

        with self.assertRaises(ValueError):
            runtime.evaluate(self._request())

    def test_rejects_invalid_limits_without_persisting_a_job(self):
        runtime = self._runtime()
        before = self._tree_snapshot(self.state_dir)

        invalid_limits = (
            {"max_updates": 0, "max_seconds": 1},
            {"max_updates": -1, "max_seconds": 1},
            {"max_updates": 1, "max_seconds": 0},
            {"max_updates": 1, "max_seconds": -1},
            {"max_updates": 10**12, "max_seconds": 1},
            {"max_updates": 1, "max_seconds": 10**12},
        )
        for limits in invalid_limits:
            with self.subTest(**limits):
                with self.assertRaises(ValueError):
                    runtime.submit(backend="fixture", **limits)

        self.assertEqual(self._tree_snapshot(self.state_dir), before)

    def test_persists_backend_failure_without_creating_a_candidate(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"failed": FailingBackend()},
        )
        self.addCleanup(runtime.close)

        submitted = runtime.submit(backend="failed", max_updates=1, max_seconds=5)
        failed = self._wait_for_job(runtime, submitted["id"])

        self.assertEqual(failed["state"], "failed")
        self.assertNotIn("candidateId", failed)
        self.assertEqual(list((self.state_dir / "candidates").iterdir()), [])
        self.assertIsNone(runtime.promotion(required=False))
        runtime.close()
        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"failed": FailingBackend()},
        )
        self.addCleanup(reopened.close)
        self.assertEqual(reopened.job(submitted["id"])["state"], "failed")
        with self.assertRaises(ValueError):
            reopened.candidate(submitted["id"])
        with self.assertRaises(ValueError):
            reopened.promote(submitted["id"], promoted_by="test-operator")

    def test_reopening_state_preserves_job_candidate_and_promotion(self):
        runtime = self._runtime()
        finished = self._wait_for_job(
            runtime,
            runtime.submit(backend="fixture", max_updates=4, max_seconds=5)["id"],
        )
        candidate_id = finished["candidateId"]
        runtime.promote(candidate_id, promoted_by="test-operator")
        candidate_before = self._candidate_snapshot(runtime.candidate(candidate_id))
        runtime.close()

        reopened = self._runtime()

        self.assertEqual(reopened.job(finished["id"]), finished)
        self.assertEqual(
            self._candidate_snapshot(reopened.candidate(candidate_id)),
            candidate_before,
        )
        self.assertEqual(reopened.promotion()["candidateId"], candidate_id)
        self.assertEqual(reopened.evaluate(self._request())["candidateId"], candidate_id)

    def test_http_routes_require_the_token_and_track_an_authorized_job(self):
        runtime = self._runtime()
        server = RuntimeHTTPServer(("127.0.0.1", 0), runtime, TOKEN)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        body = json.dumps(
            {"backend": "fixture", "maxUpdates": 2, "maxSeconds": 5}
        ).encode()

        with self.assertRaises(error.HTTPError) as refused:
            request.urlopen(
                request.Request(
                    f"{base_url}/v1/jobs",
                    data=body,
                    headers={"Content-Type": "application/json"},
                )
            )
        self.assertEqual(refused.exception.code, 401)

        submitted = self._http_json(
            request.Request(
                f"{base_url}/v1/jobs",
                data=body,
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                },
            )
        )
        finished = self._wait_for_http_job(base_url, submitted["id"])
        self.assertEqual(finished["state"], "succeeded")

    def _runtime(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
        )
        self.addCleanup(runtime.close)
        return runtime

    def _request(self):
        task = make_task(99, split="test", answer=True)
        return {
            "state": task["state"],
            "images": [
                "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
            ],
            "questions": task["questions"],
        }

    def _wait_for_job(self, runtime, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = runtime.job(job_id)
            if job["state"] in {"succeeded", "failed"}:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not finish")

    def _wait_for_http_job(self, base_url, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = self._http_json(
                request.Request(
                    f"{base_url}/v1/jobs/{job_id}",
                    headers={"Authorization": f"Bearer {TOKEN}"},
                )
            )
            if job["state"] in {"succeeded", "failed"}:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not finish")

    def _http_json(self, http_request):
        with request.urlopen(http_request) as response:
            return json.load(response)

    def _candidate_documents(self, candidate):
        self.assertIsInstance(candidate, Mapping)
        manifest = self._document(candidate, "manifest")
        report = self._document(candidate, "evaluation")
        self.assertIsInstance(manifest, Mapping)
        self.assertIsInstance(report, Mapping)
        return manifest, report

    def _document(self, candidate, name):
        for key in (name, f"{name}Path", f"{name}_path"):
            if key not in candidate:
                continue
            value = candidate[key]
            if isinstance(value, Mapping):
                return value
            return json.loads(Path(value).read_text(encoding="utf-8"))
        self.fail(f"candidate does not expose its {name}")

    def _candidate_snapshot(self, candidate):
        manifest, report = self._candidate_documents(candidate)
        return json.dumps(
            {"manifest": manifest, "report": report},
            sort_keys=True,
            separators=(",", ":"),
        )

    def _tree_snapshot(self, root):
        if not root.exists():
            return ()
        return tuple(
            (path.relative_to(root).as_posix(), path.read_bytes())
            for path in sorted(root.rglob("*"))
            if path.is_file()
        )

    def _remove_state(self):
        if not self.state_dir.exists():
            return
        for path in sorted(self.state_dir.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            else:
                path.rmdir()
        self.state_dir.rmdir()


if __name__ == "__main__":
    unittest.main()
