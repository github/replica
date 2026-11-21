"""Privacy disclosure and deletion behavior for the customer-operated runtime."""

from __future__ import annotations

import base64
import json
import shutil
import threading
import time
import unittest
from pathlib import Path
from unittest import mock
from urllib import error, parse, request

from replica_brand_check.connectors import ConnectorError, RuntimeScope
from replica_brand_check.runtime import FixtureBackend, LocalRuntime, RuntimeFailure
from replica_brand_check.runtime_server import RuntimeHTTPServer
from replica_brand_check.taskset import TasksetError
from tests.support import PNG, RULE, make_task, taskset_upload, write_taskset

TOKEN = "runtime-deletion-test-token-0123456789"
EXPORT_ID = "export_privacy_contract"
GRANT_ID = "grant_training_contract"
REVIEW_DIGEST = "sha256:" + "1" * 64
EVIDENCE_DIGEST = "sha256:" + "2" * 64


class BlockingBackend(FixtureBackend):
    """Keep a training job active until deletion has a chance to revoke it."""

    def __init__(self, started: Path, release: Path):
        self.started = started
        self.release = release

    def train(self, *args, **kwargs):
        self.started.write_text("started", encoding="utf-8")
        deadline = time.monotonic() + 5
        while not self.release.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        if not self.release.exists():
            raise AssertionError("blocking backend was not released")
        return super().train(*args, **kwargs)


class BlockingInferenceBackend(FixtureBackend):
    """Keep inference active until deletion cancels its worker."""

    def __init__(self, started: Path, release: Path):
        self.started = started
        self.release = release

    def predict(self, *args, **kwargs):
        self.started.write_text("started", encoding="utf-8")
        deadline = time.monotonic() + 5
        while not self.release.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        return super().predict(*args, **kwargs)


class CountingBlockingInferenceBackend(BlockingInferenceBackend):
    """Record backend executions while concurrent retries share one result."""

    max_concurrent_inference = 1

    def __init__(self, started: Path, release: Path, calls: Path):
        super().__init__(started, release)
        self.calls = calls

    def predict(self, *args, **kwargs):
        with self.calls.open("a", encoding="utf-8") as handle:
            handle.write("predict\n")
        return super().predict(*args, **kwargs)


class RuntimeDeletionTest(unittest.TestCase):
    def setUp(self):
        self.taskset_dir = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, answer=False),
                make_task(3, split="test", answer=True),
            ],
        )
        manifest_path = self.taskset_dir / "taskset.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest.update(
            {
                "exportId": EXPORT_ID,
                "permittingGrants": [
                    {"id": GRANT_ID, "purposes": ["training", "evaluation"]}
                ],
                "reviewDigest": REVIEW_DIGEST,
                "evidenceDigest": EVIDENCE_DIGEST,
                "retention": {
                    "policy": "delete_on_withdrawal",
                    "expiresAt": "2026-12-19T00:00:00Z",
                },
            }
        )
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        self.state_dir = self.taskset_dir.parent / f"{self.taskset_dir.name}-state"
        self.addCleanup(shutil.rmtree, self.state_dir, True)

    def test_disclosure_api_requires_auth_and_exact_scoped_bounded_filters(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-for-disclosure",
        )
        _server, _thread, base_url = self._serve(runtime)
        query = parse.urlencode(
            {
                "exportId": EXPORT_ID,
                "grantId": GRANT_ID,
                "evidenceDigest": EVIDENCE_DIGEST,
                "tasksetDigest": finished["tasksetDigest"],
                "limit": 1,
            }
        )
        url = f"{base_url}/v1/runtime-copies?{query}"

        with self.assertRaises(error.HTTPError) as unauthorized:
            request.urlopen(url)
        self.assertEqual(unauthorized.exception.code, 401)
        unauthorized.exception.close()

        first = self._http_json(
            request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
        )
        second = self._http_json(
            request.Request(
                f"{url}&cursor={parse.quote(first['nextCursor'])}",
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
        )

        self.assertEqual(len(first["items"]), 1)
        self.assertTrue(second["items"])
        self.assertNotEqual(first["items"][0]["id"], second["items"][0]["id"])
        for item in first["items"] + second["items"]:
            self.assertEqual(
                item["scope"],
                {"tenantId": "tenant-one", "repository": "github/example"},
            )
            self.assertEqual(item["sourceTrainingExportId"], EXPORT_ID)
            self.assertIn(GRANT_ID, item["permittingGrantIds"])
            self.assertIn("training", item["permittedPurposes"])
            self.assertEqual(item["evidenceDigest"], EVIDENCE_DIGEST)
            self.assertEqual(item["reviewDigest"], REVIEW_DIGEST)
            self.assertEqual(item["tasksetDigest"], finished["tasksetDigest"])
            self.assertTrue(item["runtimeCopyId"])
            self.assertTrue(item["storage"]["connector"])
            self.assertTrue(item["storage"]["reference"])
            self.assertTrue(item["createdAt"])
            self.assertIn("useState", item)
            self.assertIn("promotionState", item)
            self.assertIn("retention", item)
            self._assert_content_free(item)

        no_match = self._http_json(
            request.Request(
                f"{base_url}/v1/runtime-copies?"
                + parse.urlencode({"exportId": EXPORT_ID + "-other"}),
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
        )
        self.assertEqual(no_match["items"], [])
        status, body = self._http_error(
            request.Request(
                f"{base_url}/v1/runtime-copies?limit=1000000",
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
        )
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_input")

    def test_full_lifecycle_deletion_revokes_use_and_writes_private_receipt(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-deletion",
        )
        self.assertEqual(
            runtime.evaluate(self._evaluation())["candidateId"],
            finished["candidateId"],
        )

        _server, _thread, base_url = self._serve(runtime)
        deletion_url = f"{base_url}/v1/deletions"
        deletion_body = json.dumps(
            {
                "selectors": {"exportId": EXPORT_ID},
                "requestedBy": "privacy-operator",
                "reason": "training consent withdrawn",
            }
        ).encode()
        status, unauthorized = self._http_error(
            request.Request(
                deletion_url,
                data=deletion_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
        )
        self.assertEqual(status, 401)
        self.assertEqual(unauthorized["error"]["code"], "unauthorized")
        requested = self._http_json(
            request.Request(
                deletion_url,
                data=deletion_body,
                headers={
                    "Authorization": f"Bearer {TOKEN}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "delete-export",
                },
                method="POST",
            )
        )
        receipt = self._wait_for_deletion(runtime, requested["id"])

        self.assertEqual(receipt["state"], "completed")
        self.assertTrue(receipt["revokedAt"])
        self.assertTrue(receipt["completedAt"])
        self.assertEqual(receipt["selectors"], {"exportId": EXPORT_ID})
        self.assertTrue(receipt["items"])
        self.assertTrue(
            all(item["state"] in {"deleted", "retained"} for item in receipt["items"])
        )
        for item in receipt["items"]:
            if item["state"] == "retained":
                self.assertTrue(item["retention"]["reason"])
                self.assertTrue(item["retention"]["authority"])
                self.assertTrue(item["retention"]["expiresAt"])
        self._assert_content_free(receipt)
        telemetry = [
            {
                "kind": record.kind,
                "quantity": record.quantity,
                "unit": record.unit,
                "metadata": dict(record.metadata),
            }
            for record in runtime.local_connectors.observability.records()
        ]
        self._assert_content_free(telemetry)

        with self.assertRaises(RuntimeFailure) as not_ready:
            runtime.ready()
        self.assertEqual(not_ready.exception.code, "deletion_revoked")
        with self.assertRaises(RuntimeFailure) as inference:
            runtime.evaluate(self._evaluation())
        self.assertEqual(inference.exception.code, "deletion_revoked")
        with self.assertRaises(RuntimeFailure) as promotion:
            runtime.promote(
                finished["candidateId"],
                promoted_by="privacy-operator",
                expected_generation=1,
                idempotency_key="promote-after-deletion",
            )
        self.assertEqual(promotion.exception.code, "deletion_revoked")

    def test_deletion_api_derives_distinct_default_retry_keys_from_each_body(self):
        runtime = self._runtime()
        _server, _thread, base_url = self._serve(runtime)
        headers = {
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        }

        first = self._http_json(
            request.Request(
                f"{base_url}/v1/deletions",
                data=json.dumps(
                    {
                        "selectors": {"exportId": "export_missing_one"},
                        "requestedBy": "privacy-operator",
                        "reason": "first withdrawal",
                    }
                ).encode(),
                headers=headers,
                method="POST",
            )
        )
        second = self._http_json(
            request.Request(
                f"{base_url}/v1/deletions",
                data=json.dumps(
                    {
                        "selectors": {"exportId": "export_missing_two"},
                        "requestedBy": "privacy-operator",
                        "reason": "second withdrawal",
                    }
                ).encode(),
                headers=headers,
                method="POST",
            )
        )

        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["state"], "completed")
        self.assertEqual(second["state"], "completed")

    def test_duplicate_deletion_returns_one_durable_receipt_across_restart(self):
        runtime = self._runtime()
        self._train(runtime)
        first = runtime.request_deletion(
            {"grantId": GRANT_ID},
            requested_by="privacy-operator",
            reason="grant withdrawn",
            idempotency_key="delete-grant",
        )
        same_retry = runtime.request_deletion(
            {"grantId": GRANT_ID},
            requested_by="privacy-operator",
            reason="grant withdrawn",
            idempotency_key="delete-grant",
        )
        self.assertEqual(same_retry["id"], first["id"])
        completed = self._wait_for_deletion(runtime, first["id"])
        runtime.close()

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)
        duplicate = reopened.request_deletion(
            {"grantId": GRANT_ID},
            requested_by="privacy-operator",
            reason="grant withdrawn",
            idempotency_key="delete-grant-after-restart",
        )

        self.assertEqual(duplicate["id"], first["id"])
        self.assertEqual(reopened.deletion(first["id"]), completed)

    def test_partial_connector_failure_stays_retryable_and_completes_after_restart(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        real_delete = runtime.connectors.candidates.delete
        attempts = 0

        def fail_once(candidate_id, context):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ConnectorError(
                    "candidate_delete_unavailable",
                    "Candidate storage is temporarily unavailable.",
                    category="unavailable",
                    retryable=True,
                )
            return real_delete(candidate_id, context)

        with mock.patch.object(
            runtime.connectors.candidates, "delete", side_effect=fail_once
        ):
            requested = runtime.request_deletion(
                {"tasksetDigest": finished["tasksetDigest"]},
                requested_by="privacy-operator",
                reason="source taskset deleted",
                idempotency_key="delete-with-retry",
            )
            pending = self._wait_for_deletion(runtime, requested["id"], state="pending")

        self.assertEqual(pending["state"], "pending")
        self.assertTrue(pending["pendingItems"])
        self.assertTrue(all(item["retryable"] for item in pending["pendingItems"]))
        self.assertNotIn("completedAt", pending)
        runtime.close()

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)
        completed = self._wait_for_deletion(reopened, requested["id"])

        self.assertEqual(completed["state"], "completed")
        self.assertEqual(completed["pendingItems"], [])
        self.assertGreaterEqual(attempts, 1)

    def test_pending_revocation_cancels_racing_work_and_blocks_new_uses(self):
        started = self._control("deletion-job-started")
        release = self._control("deletion-job-release")
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={
                "blocking": BlockingBackend(started, release),
                "fixture": FixtureBackend(),
            },
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(release.unlink, missing_ok=True)
        self.addCleanup(runtime.close)
        running = runtime.submit(
            backend="blocking", max_updates=2, max_seconds=30, max_credits=2
        )
        digest, upload = taskset_upload(self.taskset_dir)
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())

        deletion = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="consent withdrawn during training",
            idempotency_key="delete-racing-training",
        )

        with self.assertRaises(RuntimeFailure) as blocked:
            runtime.submit(
                backend="fixture", max_updates=1, max_seconds=5, max_credits=1
            )
        self.assertEqual(blocked.exception.code, "deletion_revoked")
        for operation in (
            lambda: runtime.evaluate(self._evaluation()),
            lambda: runtime.promote(
                "candidate_" + "0" * 64,
                promoted_by="privacy-operator",
                expected_generation=0,
                idempotency_key="racing-promotion",
            ),
        ):
            with self.subTest(operation=operation):
                with self.assertRaises(RuntimeFailure):
                    operation()
        with self.assertRaises(RuntimeFailure) as upload_blocked:
            runtime.register_taskset(
                digest,
                upload,
                idempotency_key="upload-after-revocation",
            )
        self.assertEqual(upload_blocked.exception.code, "deletion_revoked")
        release.write_text("release", encoding="utf-8")
        self.assertEqual(self._wait_for_job(runtime, running["id"])["state"], "cancelled")
        receipt = self._wait_for_deletion(runtime, deletion["id"])
        self.assertEqual(receipt["state"], "completed")

    def test_withdrawal_cancels_in_flight_inference_before_receipt_completion(self):
        started = self._control("deletion-inference-started")
        release = self._control("deletion-inference-release")
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": BlockingInferenceBackend(started, release)},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(release.write_text, "release", encoding="utf-8")
        self.addCleanup(runtime.close)
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-inference-withdrawal",
        )
        failures = []

        def evaluate():
            try:
                runtime.evaluate(self._evaluation())
            except Exception as failure:
                failures.append(failure)

        thread = threading.Thread(target=evaluate)
        thread.start()
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())

        receipt = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="consent withdrawn during inference",
            idempotency_key="delete-in-flight-inference",
        )
        thread.join(5)

        self.assertFalse(thread.is_alive())
        self.assertEqual(receipt["state"], "completed")
        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], RuntimeFailure)
        self.assertEqual(failures[0].code, "deletion_revoked")

    def test_candidate_inventory_is_durable_before_candidate_bytes(self):
        runtime = self._runtime()
        real_put = runtime.connectors.privacy.put_copy

        def fail_candidate(record, context):
            if record["kind"] == "candidate":
                raise ConnectorError(
                    "privacy_unavailable",
                    "Privacy inventory is unavailable.",
                    category="unavailable",
                    retryable=True,
                )
            return real_put(record, context)

        with mock.patch.object(
            runtime.connectors.privacy,
            "put_copy",
            side_effect=fail_candidate,
        ):
            finished = self._wait_for_job(
                runtime,
                runtime.submit(
                    backend="fixture",
                    max_updates=2,
                    max_seconds=5,
                    max_credits=2,
                )["id"],
            )

        self.assertEqual(finished["state"], "failed")
        self.assertEqual(
            list((self.state_dir / "candidates").glob("candidate_*")),
            [],
        )

    def test_taskset_inventory_is_reserved_before_uploaded_bytes(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)

        with mock.patch.object(
            runtime.connectors.privacy,
            "put_copy",
            side_effect=ConnectorError(
                "privacy_unavailable",
                "Privacy inventory is unavailable.",
                category="unavailable",
                retryable=True,
            ),
        ), self.assertRaises(RuntimeFailure) as failed:
            runtime.register_taskset(
                digest,
                upload,
                idempotency_key="upload-without-inventory",
            )

        self.assertEqual(failed.exception.code, "privacy_unavailable")
        self.assertFalse((self.state_dir / "tasksets" / digest).exists())

    def test_mounting_an_uploaded_taskset_reconciles_operator_retention(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        runtime.register_taskset(digest, upload, idempotency_key="upload-before-mount")
        runtime.close()

        mounted = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(mounted.close)
        receipt = mounted.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="training consent withdrawn",
            idempotency_key="delete-mounted-upload",
        )

        self.assertEqual(receipt["state"], "completed")
        taskset_item = next(item for item in receipt["items"] if item["kind"] == "taskset")
        self.assertEqual(taskset_item["state"], "retained")
        self.assertEqual(
            taskset_item["retention"]["mode"],
            "operator_managed",
        )
        self.assertTrue((self.taskset_dir / "taskset.json").is_file())

    def test_concurrent_inference_retries_share_one_backend_execution(self):
        started = self._control("retry-inference-started")
        release = self._control("retry-inference-release")
        calls = self._control("retry-inference-calls")
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={
                "fixture": CountingBlockingInferenceBackend(started, release, calls)
            },
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(release.write_text, "release", encoding="utf-8")
        self.addCleanup(runtime.close)
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-retry",
        )
        responses = []
        failures = []

        def evaluate():
            try:
                responses.append(
                    runtime.evaluate(
                        self._evaluation(),
                        idempotency_key="same-inference",
                    )
                )
            except Exception as failure:
                failures.append(failure)

        first = threading.Thread(target=evaluate)
        second = threading.Thread(target=evaluate)
        first.start()
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(started.exists())
        second.start()
        time.sleep(0.05)
        release.write_text("release", encoding="utf-8")
        first.join(5)
        second.join(5)

        self.assertFalse(failures)
        self.assertEqual(len(responses), 2)
        self.assertEqual(responses[0], responses[1])
        self.assertEqual(calls.read_text(encoding="utf-8").splitlines(), ["predict"])
        self.assertEqual(runtime._inference_idempotency_locks, {})

    def test_explicit_missing_mounted_taskset_fails_startup(self):
        missing = self._control("missing-taskset")

        with self.assertRaises(TasksetError):
            LocalRuntime(
                self.state_dir,
                missing,
                environment="test",
                scope=RuntimeScope("tenant-one", "github/example"),
            )

    def _runtime(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": FixtureBackend()},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        return runtime

    def _control(self, name):
        return self.state_dir.with_name(f"{self.state_dir.name}-{name}")

    def _train(self, runtime):
        job = runtime.submit(
            backend="fixture", max_updates=8, max_seconds=5, max_credits=8
        )
        finished = self._wait_for_job(runtime, job["id"])
        self.assertEqual(finished["state"], "succeeded")
        return finished

    def _evaluation(self):
        task = make_task(99, split="test", answer=True)
        return {
            "state": task["state"],
            "images": [
                "data:image/png;base64," + base64.b64encode(PNG).decode("ascii")
            ],
            "questions": {RULE: task["questions"][RULE]},
        }

    def _wait_for_job(self, runtime, job_id):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = runtime.job(job_id)
            if job["state"] in {"succeeded", "failed", "cancelled"}:
                return job
            time.sleep(0.01)
        self.fail(f"job {job_id} did not finish")

    def _wait_for_deletion(self, runtime, deletion_id, *, state="completed"):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            receipt = runtime.deletion(deletion_id)
            if receipt["state"] == state:
                return receipt
            if receipt["state"] == "failed":
                self.fail(f"deletion {deletion_id} failed: {receipt}")
            time.sleep(0.01)
        self.fail(f"deletion {deletion_id} did not reach {state}")

    def _serve(self, runtime):
        server = RuntimeHTTPServer(("127.0.0.1", 0), runtime, TOKEN)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 1)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server, thread, f"http://127.0.0.1:{server.server_address[1]}"

    def _http_json(self, http_request):
        with request.urlopen(http_request) as response:
            return json.load(response)

    def _http_error(self, http_request):
        with self.assertRaises(error.HTTPError) as failed:
            request.urlopen(http_request)
        with failed.exception as response:
            return response.code, json.load(response)

    def _assert_content_free(self, value):
        serialized = json.dumps(value, sort_keys=True)
        self.assertNotIn("Put a visible label", serialized)
        self.assertNotIn("data:image", serialized)
        self.assertNotIn(base64.b64encode(PNG).decode("ascii"), serialized)
        for forbidden in ("questions", "labels", "tasks", "images", "evidence"):
            self.assertNotIn(forbidden, self._nested_keys(value))

    def _nested_keys(self, value):
        if isinstance(value, dict):
            return set(value).union(
                *(self._nested_keys(item) for item in value.values())
            )
        if isinstance(value, list):
            return set().union(*(self._nested_keys(item) for item in value))
        return set()


if __name__ == "__main__":
    unittest.main()
