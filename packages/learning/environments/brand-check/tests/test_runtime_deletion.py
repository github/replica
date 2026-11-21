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

from replica_brand_check.connectors import ConnectorError, RuntimeOwner, RuntimeScope
from replica_brand_check.runtime import FixtureBackend, LocalRuntime, RuntimeFailure
from replica_brand_check.runtime_server import RuntimeHTTPServer
from replica_brand_check.taskset import TasksetError
from tests.support import PNG, RULE, make_task, taskset_upload, write_taskset

TOKEN = "runtime-deletion-test-token-0123456789"
EXPORT_ID = "export_privacy_contract"
GRANT_ID = "grant_training_contract"
REVIEW_DIGEST = "sha256:" + "1" * 64
RAW_EVIDENCE_DIGEST = "sha256:" + "2" * 64
EVIDENCE_DIGEST = "sha256:" + __import__("hashlib").sha256(
    json.dumps(
        [RAW_EVIDENCE_DIGEST],
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
).hexdigest()


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


class InvalidInferenceResultBackend(FixtureBackend):
    """Persist a result that runtime response validation must reject."""

    def predict(self, *args, **kwargs):
        del args, kwargs
        return {RULE: {"probabilities": {"yes": 2, "no": -1}}}


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
                "provenance": {
                    "exportDigest": "sha256:" + "4" * 64,
                    "grantIds": [GRANT_ID],
                    "purposes": ["training", "evaluation"],
                    "reviewDigests": [REVIEW_DIGEST],
                    "evidenceDigests": [RAW_EVIDENCE_DIGEST],
                    "evidenceDigest": EVIDENCE_DIGEST,
                },
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

    def test_explicit_retention_keeps_bytes_but_revokes_every_use(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-retention",
        )
        receipt = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="legal hold",
            retention={
                "mode": "retain",
                "legalReason": "A documented litigation hold applies.",
                "expiresAt": "2027-01-01T00:00:00Z",
            },
            idempotency_key="retain-export",
        )

        self.assertEqual(receipt["state"], "completed")
        self.assertTrue(receipt["items"])
        self.assertTrue(all(item["state"] == "retained" for item in receipt["items"]))
        self.assertTrue((self.state_dir / "candidates" / finished["candidateId"]).is_dir())
        self.assertTrue(any((self.state_dir / "tasksets").iterdir()))
        for operation in (
            lambda: runtime.submit(
                backend="fixture",
                max_updates=1,
                max_seconds=5,
                max_credits=1,
            ),
            lambda: runtime.promote(
                finished["candidateId"],
                promoted_by="privacy-operator",
                expected_generation=1,
                idempotency_key="promote-retained",
            ),
            lambda: runtime.evaluate(self._evaluation()),
        ):
            with self.assertRaises(RuntimeFailure) as blocked:
                operation()
            self.assertEqual(blocked.exception.code, "deletion_revoked")

    def test_rejects_malformed_retention_requests(self):
        runtime = self._runtime()
        for retention in (
            {"mode": "retain"},
            {"mode": "retain", "legalReason": "hold", "retainUntil": "2027-01-01"},
            {"mode": "retain", "legalReason": "hold", "expiresAt": "not-a-date"},
            {"mode": "delete_on_withdrawal", "legalReason": "hold"},
        ):
            with self.subTest(retention=retention):
                with self.assertRaises(RuntimeFailure) as invalid:
                    runtime.request_deletion(
                        {"exportId": EXPORT_ID},
                        requested_by="privacy-operator",
                        reason="invalid retention",
                        retention=retention,
                        idempotency_key="invalid-" + str(len(str(retention))),
                    )
                self.assertEqual(invalid.exception.code, "invalid_input")

    def test_refuses_missing_provenance_and_non_training_permission(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        missing = json.loads(json.dumps(upload))
        missing["manifest"]["provenance"].pop("grantIds")
        with self.assertRaises(RuntimeFailure) as invalid:
            runtime.register_taskset(
                digest,
                missing,
                idempotency_key="missing-provenance",
            )
        self.assertEqual(invalid.exception.code, "taskset_provenance_invalid")

        evaluation_only = json.loads(json.dumps(upload))
        evaluation_only["manifest"]["provenance"]["purposes"] = ["evaluation"]
        directory = self._control("evaluation-only")
        directory.mkdir()
        (directory / "images").mkdir()
        (directory / "taskset.json").write_text(
            json.dumps(evaluation_only["manifest"]),
            encoding="utf-8",
        )
        (directory / "tasks.jsonl").write_text(
            "".join(json.dumps(task) + "\n" for task in evaluation_only["tasks"]),
            encoding="utf-8",
        )
        for image in evaluation_only["images"]:
            destination = directory / image["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(base64.b64decode(image["dataBase64"]))
        evaluation_digest, evaluation_upload = taskset_upload(directory)
        runtime.register_taskset(
            evaluation_digest,
            evaluation_upload,
            idempotency_key="evaluation-only-upload",
        )
        with self.assertRaises(RuntimeFailure) as forbidden:
            runtime.submit(
                backend="fixture",
                max_updates=1,
                max_seconds=5,
                max_credits=1,
                taskset_digest=f"sha256:{evaluation_digest}",
            )
        self.assertEqual(forbidden.exception.code, "training_not_permitted")

    def test_deletion_removes_inference_retry_results_and_cached_taskset(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        runtime.register_taskset(digest, upload, idempotency_key="upload-for-cache-deletion")
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture",
                max_updates=8,
                max_seconds=5,
                max_credits=8,
                taskset_digest=f"sha256:{digest}",
            )["id"],
        )
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-retry-deletion",
        )
        runtime.evaluate(self._evaluation(), idempotency_key="durable-inference")
        inference_path = (
            self.state_dir
            / "inference"
            / ".idempotency"
            / __import__("hashlib").sha256(b"durable-inference").hexdigest()
        )
        self.assertTrue(inference_path.is_file())
        self.assertTrue(runtime._tasksets)

        receipt = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="delete retry result",
            idempotency_key="delete-retry-result",
        )

        self.assertEqual(receipt["state"], "completed")
        self.assertFalse(inference_path.exists())
        self.assertEqual(runtime._tasksets, {})
        self.assertEqual(runtime._verified_taskset_directories, {})

    def test_restart_backfills_existing_tasksets_candidates_and_reports(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-backfill",
        )
        runtime.close()
        shutil.rmtree(self.state_dir / "privacy")

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)
        disclosed = reopened.disclose({"exportId": EXPORT_ID})

        self.assertEqual(
            {item["kind"] for item in disclosed["items"]},
            {"taskset", "candidate", "report"},
        )
        self.assertEqual(
            reopened.evaluate(self._evaluation())["candidateId"],
            finished["candidateId"],
        )

    def test_restart_removes_legacy_inference_retries_without_provenance(self):
        runtime = self._runtime()
        runtime.close()
        legacy = self.state_dir / "inference" / ".idempotency" / ("a" * 64)
        legacy.write_text(
            json.dumps(
                {
                    "requestDigest": "sha256:" + "1" * 64,
                    "result": {RULE: {"probabilities": {"yes": 1, "no": 0}}},
                }
            ),
            encoding="utf-8",
        )

        reopened = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)

        self.assertFalse(legacy.exists())

    def test_upgrade_reconciles_backfilled_copies_against_completed_withdrawal(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        runtime.register_taskset(digest, upload, idempotency_key="legacy-upload")
        finished = self._wait_for_job(
            runtime,
            runtime.submit(
                backend="fixture",
                max_updates=2,
                max_seconds=5,
                max_credits=2,
                taskset_digest=f"sha256:{digest}",
            )["id"],
        )
        context = runtime._operation_context(
            "legacy-completed-deletion",
            max_seconds=30,
            owner=RuntimeOwner("human", "privacy-operator"),
            idempotency_key="legacy-completed-deletion",
        )
        receipt = runtime.connectors.privacy.create_deletion(
            {
                "selectors": {"exportId": EXPORT_ID},
                "requestedBy": "privacy-operator",
                "reason": "legacy completed withdrawal",
                "retention": None,
            },
            context,
        )
        runtime.connectors.privacy.update_deletion(
            receipt["id"],
            {
                **receipt,
                "state": "completed",
                "updatedAt": "2026-11-20T00:00:00Z",
                "completedAt": "2026-11-20T00:00:00Z",
            },
            expected_version=receipt["version"],
            context=context,
        )
        shutil.rmtree(self.state_dir / "privacy" / "copies")
        (self.state_dir / "privacy" / "copies").mkdir(mode=0o700)
        runtime.close()

        reopened = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)

        self.assertFalse((self.state_dir / "tasksets" / digest).exists())
        self.assertFalse(
            (self.state_dir / "candidates" / finished["candidateId"]).exists()
        )

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
        reopened_receipt = reopened.deletion(first["id"])
        self.assertEqual(reopened_receipt["id"], completed["id"])
        self.assertEqual(reopened_receipt["state"], "completed")
        self.assertEqual(reopened_receipt["selectors"], completed["selectors"])
        self.assertEqual(reopened_receipt["items"], completed["items"])

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
            pending = requested

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
        receipt = self._wait_for_deletion(runtime, receipt["id"])
        self.assertEqual(receipt["state"], "completed")
        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], RuntimeFailure)
        self.assertEqual(failures[0].code, "deletion_revoked")

    def test_withdrawal_waits_for_in_flight_retry_inventory_before_completion(self):
        started = self._control("retry-withdrawal-started")
        release = self._control("retry-withdrawal-release")
        calls = self._control("retry-withdrawal-calls")
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
            idempotency_key="promote-before-retry-withdrawal",
        )
        failures = []

        def evaluate():
            try:
                runtime.evaluate(
                    self._evaluation(),
                    idempotency_key="withdrawn-inference-retry",
                )
            except Exception as failure:
                failures.append(failure)

        thread = threading.Thread(target=evaluate)
        thread.start()
        deadline = time.monotonic() + 5
        while not started.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        receipt = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="withdraw during durable retry",
            idempotency_key="delete-during-durable-retry",
        )
        self.assertEqual(receipt["state"], "pending")
        release.write_text("release", encoding="utf-8")
        thread.join(5)
        completed = self._wait_for_deletion(runtime, receipt["id"])

        self.assertEqual(completed["state"], "completed")
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].code, "deletion_revoked")
        remaining = list((self.state_dir / "inference" / ".idempotency").iterdir())
        self.assertEqual(remaining, [])

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

    def test_inventory_failure_does_not_delete_a_preexisting_uploaded_taskset(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        runtime.register_taskset(digest, upload, idempotency_key="first-upload")
        copy_id = next(
            item["id"]
            for item in runtime.disclose({"tasksetDigest": f"sha256:{digest}"})["items"]
            if item["kind"] == "taskset"
        )
        (self.state_dir / "privacy" / "copies" / f"{copy_id}.json").unlink()

        with mock.patch.object(
            runtime.connectors.privacy,
            "put_copy",
            side_effect=ConnectorError(
                "privacy_unavailable",
                "Privacy inventory is unavailable.",
                category="unavailable",
                retryable=True,
            ),
        ), self.assertRaises(RuntimeFailure):
            runtime.register_taskset(
                digest,
                upload,
                idempotency_key="retry-existing-upload",
            )

        self.assertTrue((self.state_dir / "tasksets" / digest).is_dir())

    def test_successful_taskset_retry_reactivates_failed_registration_inventory(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        real_register = runtime.connectors.tasksets.register
        attempts = 0

        def fail_once(bundle, context):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise ConnectorError(
                    "taskset_unavailable",
                    "Taskset storage is unavailable.",
                    category="unavailable",
                    retryable=True,
                )
            return real_register(bundle, context)

        with mock.patch.object(
            runtime.connectors.tasksets,
            "register",
            side_effect=fail_once,
        ):
            with self.assertRaises(RuntimeFailure):
                runtime.register_taskset(
                    digest,
                    upload,
                    idempotency_key="failed-taskset-registration",
                )
            runtime.register_taskset(
                digest,
                upload,
                idempotency_key="successful-taskset-registration",
            )

        disclosed = runtime.disclose({"tasksetDigest": f"sha256:{digest}"})
        uploaded = next(
            item
            for item in disclosed["items"]
            if item["storage"]["reference"].startswith("uploaded-taskset:")
        )
        self.assertEqual(uploaded["useState"], "active")

    def test_legacy_failed_registration_cannot_delete_verified_taskset(self):
        digest, upload = taskset_upload(self.taskset_dir)
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        runtime.register_taskset(digest, upload, idempotency_key="verified-upload")
        current = runtime.disclose({"tasksetDigest": f"sha256:{digest}"})["items"][0]
        legacy = {
            **current,
            "id": "copy_"
            + __import__("hashlib")
            .sha256(f"taskset\0uploaded:taskset:{digest}".encode())
            .hexdigest()[:32],
            "runtimeCopyId": f"uploaded:taskset:{digest}",
            "sourceTrainingExportId": "export_stale_failed_upload",
            "useState": "deleted",
            "retention": {
                "mode": "registration_failed",
                "deletedAt": "2026-11-20T00:00:00Z",
            },
        }
        context = runtime._operation_context(
            "legacy-registration",
            max_seconds=30,
            owner=RuntimeOwner("service", "test"),
        )
        runtime.connectors.privacy.put_copy(legacy, context)
        runtime.close()

        reopened = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(reopened.close)
        receipt = reopened.request_deletion(
            {"exportId": "export_stale_failed_upload"},
            requested_by="privacy-operator",
            reason="withdraw stale failed upload",
            idempotency_key="delete-stale-failed-upload",
        )

        self.assertEqual(receipt["state"], "completed")
        self.assertTrue((self.state_dir / "tasksets" / digest).is_dir())
        retained = next(item for item in receipt["items"] if item["runtimeCopyId"] == legacy["id"])
        self.assertEqual(retained["state"], "retained")

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
        taskset_item = next(
            item
            for item in receipt["items"]
            if item["kind"] == "taskset" and item["state"] == "retained"
        )
        self.assertEqual(taskset_item["state"], "retained")
        self.assertEqual(
            taskset_item["retention"]["mode"],
            "operator_managed",
        )
        self.assertTrue((self.taskset_dir / "taskset.json").is_file())
        self.assertFalse((self.state_dir / "tasksets" / digest).exists())

    def test_mount_after_completed_withdrawal_is_retained_and_never_reactivated(self):
        runtime = LocalRuntime(
            self.state_dir,
            None,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        receipt = runtime.request_deletion(
            {"exportId": EXPORT_ID},
            requested_by="privacy-operator",
            reason="training consent withdrawn before mount",
            idempotency_key="delete-before-mount",
        )
        self.assertEqual(receipt["state"], "completed")
        runtime.close()

        mounted = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(mounted.close)
        disclosed = mounted.disclose({"exportId": EXPORT_ID})
        mounted_copy = next(
            item
            for item in disclosed["items"]
            if item["storage"]["reference"].startswith("mounted-taskset:")
        )

        self.assertEqual(mounted_copy["useState"], "retained")
        self.assertEqual(mounted_copy["retention"]["mode"], "operator_managed")
        with self.assertRaises(RuntimeFailure) as blocked:
            mounted.submit(
                backend="fixture",
                max_updates=1,
                max_seconds=5,
                max_credits=1,
            )
        self.assertEqual(blocked.exception.code, "deletion_revoked")

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

    def test_inference_work_directory_failure_releases_retry_and_cancellation_state(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-work-failure",
        )
        original_mkdir = Path.mkdir

        def fail_inference_work(path, *args, **kwargs):
            if path.parent.name == "work" and path.name.startswith("inference_"):
                raise OSError("disk unavailable")
            return original_mkdir(path, *args, **kwargs)

        with mock.patch.object(Path, "mkdir", new=fail_inference_work):
            with self.assertRaises(RuntimeFailure) as failed:
                runtime.evaluate(
                    self._evaluation(),
                    idempotency_key="work-directory-failure",
                )

        self.assertEqual(failed.exception.code, "work_directory_unavailable")
        self.assertEqual(runtime._inference_idempotency_locks, {})
        self.assertEqual(runtime._inference_cancellations, {})
        self.assertFalse(
            any(
                item["kind"] == "inference"
                and item["useState"] == "registering"
                for item in runtime.disclose({"exportId": EXPORT_ID})["items"]
            )
        )

    def test_inference_artifact_failure_removes_work_directory(self):
        runtime = self._runtime()
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-before-artifact-failure",
        )

        with mock.patch.object(
            runtime.local_connectors.candidates,
            "artifact_path",
            side_effect=ConnectorError(
                "candidate_not_found",
                "The candidate artifact was not found.",
                category="not_found",
            ),
        ), self.assertRaises(RuntimeFailure):
            runtime.evaluate(
                self._evaluation(),
                idempotency_key="artifact-failure",
            )

        self.assertEqual(
            list((self.state_dir / "work").glob("inference_*")),
            [],
        )
        self.assertEqual(runtime._inference_idempotency_locks, {})
        self.assertEqual(runtime._inference_cancellations, {})

    def test_invalid_inference_response_removes_uninventoried_retry_result(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": InvalidInferenceResultBackend()},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-invalid-response",
        )

        with self.assertRaises(RuntimeFailure) as invalid:
            runtime.evaluate(
                self._evaluation(),
                idempotency_key="invalid-response-retry",
            )

        self.assertEqual(invalid.exception.code, "inference_failed")
        self.assertEqual(
            list((self.state_dir / "inference" / ".idempotency").iterdir()),
            [],
        )

    def test_failed_inference_cleanup_remains_inventoried_for_deletion_retry(self):
        runtime = LocalRuntime(
            self.state_dir,
            self.taskset_dir,
            backends={"fixture": InvalidInferenceResultBackend()},
            environment="test",
            scope=RuntimeScope("tenant-one", "github/example"),
        )
        self.addCleanup(runtime.close)
        finished = self._train(runtime)
        runtime.promote(
            finished["candidateId"],
            promoted_by="privacy-operator",
            expected_generation=0,
            idempotency_key="promote-cleanup-failure",
        )
        connector = runtime.inference_connectors["fixture"]
        real_delete = connector.delete
        failure = ConnectorError(
            "inference_result_delete_unavailable",
            "Retry storage is unavailable.",
            category="unavailable",
            retryable=True,
        )

        with mock.patch.object(connector, "delete", side_effect=failure):
            with self.assertRaises(RuntimeFailure):
                runtime.evaluate(
                    self._evaluation(),
                    idempotency_key="cleanup-failure-retry",
                )
            disclosed = runtime.disclose({"exportId": EXPORT_ID})
            retry_copy = next(
                item for item in disclosed["items"] if item["kind"] == "inference"
            )
            self.assertEqual(retry_copy["useState"], "registering")
            receipt = runtime.request_deletion(
                {"exportId": EXPORT_ID},
                requested_by="privacy-operator",
                reason="delete failed retry cleanup",
                idempotency_key="delete-failed-retry-cleanup",
            )
            self.assertEqual(receipt["state"], "pending")

        self.assertTrue(real_delete(retry_copy["storage"]["reference"], runtime._operation_context(
            "cleanup-retry",
            max_seconds=30,
            owner=RuntimeOwner("service", "test"),
        )))
        completed = self._wait_for_deletion(runtime, receipt["id"])
        self.assertEqual(completed["state"], "completed")

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

    @staticmethod
    def _aggregate_digest(values):
        import hashlib

        return "sha256:" + hashlib.sha256(
            json.dumps(values, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

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
