"""Deletion conformance for provider-neutral runtime storage connectors."""

from __future__ import annotations

import hashlib
import json
import shutil
import time
import unittest

from replica_brand_check.connectors import (
    Artifact,
    Cancellation,
    Candidate,
    ConnectorError,
    ContentDigest,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
)
from replica_brand_check.local_connectors import create_local_connector_bundle
from replica_brand_check.runtime import FixtureBackend
from tests.support import make_task, taskset_bundle, write_taskset


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


class ConnectorDeletionConformanceTest(unittest.TestCase):
    def setUp(self):
        self.taskset_dir = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        self.state_dir = self.taskset_dir.parent / f"{self.taskset_dir.name}-state"
        self.addCleanup(shutil.rmtree, self.state_dir, True)
        self.scope = RuntimeScope("tenant-one", "github/example")
        self.bundle = create_local_connector_bundle(
            self.state_dir,
            self.taskset_dir,
            {"fixture": FixtureBackend()},
            scope=self.scope,
        )
        self.addCleanup(self.bundle.close)

    def test_enumerates_scoped_copies_with_exact_filters_and_stable_cursors(self):
        privacy = self.bundle.connectors.privacy
        first = privacy.put_copy(
            self._copy("copy_taskset", "taskset", "sha256:" + "a" * 64),
            self._context("put-taskset"),
        )
        second = privacy.put_copy(
            self._copy("copy_candidate", "candidate", "sha256:" + "a" * 64),
            self._context("put-candidate"),
        )

        page_one, cursor = privacy.list_copies(
            {
                "exportId": "export_contract",
                "grantId": "grant_contract",
                "evidenceDigest": "sha256:" + "b" * 64,
                "tasksetDigest": "sha256:" + "a" * 64,
            },
            cursor=None,
            limit=1,
            context=self._context("list-first"),
        )
        page_two, end = privacy.list_copies(
            {
                "exportId": "export_contract",
                "grantId": "grant_contract",
                "evidenceDigest": "sha256:" + "b" * 64,
                "tasksetDigest": "sha256:" + "a" * 64,
            },
            cursor=cursor,
            limit=1,
            context=self._context("list-second"),
        )

        self.assertEqual(
            {item["id"] for item in [*page_one, *page_two]},
            {first["id"], second["id"]},
        )
        self.assertIsNotNone(cursor)
        self.assertIsNone(end)
        no_match, no_cursor = privacy.list_copies(
            {"exportId": "export_contract-other"},
            cursor=None,
            limit=10,
            context=self._context("list-no-match"),
        )
        self.assertEqual(no_match, ())
        self.assertIsNone(no_cursor)
        with self.assertRaises(ConnectorError) as unbounded:
            privacy.list_copies(
                {},
                cursor=None,
                limit=1_000_000,
                context=self._context("list-unbounded"),
            )
        self.assertEqual(unbounded.exception.category, "invalid_input")
        with self.assertRaises(ConnectorError) as hidden:
            privacy.list_copies(
                {},
                cursor=None,
                limit=10,
                context=self._context(
                    "list-other-scope",
                    scope=RuntimeScope("tenant-two", "github/example"),
                ),
            )
        self.assertIn(hidden.exception.category, ("not_found", "unauthorized"))

    def test_delete_and_tombstone_are_idempotent_without_losing_receipt_metadata(self):
        uploaded_directory = write_taskset(
            self,
            [
                make_task(11, answer=True),
                make_task(12, split="test", answer=True),
            ],
        )
        context = self._context("register")
        registered = self.bundle.connectors.tasksets.register(
            taskset_bundle(uploaded_directory),
            context,
        )
        artifact = Artifact(
            _digest(b"adapter"),
            "application/octet-stream",
            b"adapter",
            {"name": "adapter.bin"},
        )
        candidate = Candidate(
            "candidate_contract",
            _digest(b"candidate"),
            {"tasksetDigest": str(registered.digest)},
            (artifact,),
        )
        self.bundle.connectors.candidates.put(candidate, self._context("put-candidate"))
        taskset_copy = self.bundle.connectors.privacy.put_copy(
            self._copy(
                "copy_taskset",
                "taskset",
                str(registered.digest),
                storage_reference=registered.reference,
            ),
            self._context("put-taskset-copy"),
        )
        candidate_copy = self.bundle.connectors.privacy.put_copy(
            self._copy(
                "copy_candidate",
                "candidate",
                str(registered.digest),
                storage_reference=candidate.id,
            ),
            self._context("put-candidate-copy"),
        )

        self.assertTrue(
            self.bundle.connectors.tasksets.delete(
                registered.reference,
                self._context("delete-taskset"),
            )
        )
        self.assertFalse(
            self.bundle.connectors.tasksets.delete(
                registered.reference,
                self._context("delete-taskset-retry"),
            )
        )
        self.assertTrue(
            self.bundle.connectors.candidates.delete(
                candidate.id,
                self._context("delete-candidate"),
            )
        )
        self.assertFalse(
            self.bundle.connectors.candidates.delete(
                candidate.id,
                self._context("delete-candidate-retry"),
            )
        )
        for copy in (taskset_copy, candidate_copy):
            tombstone = self.bundle.connectors.privacy.tombstone_copy(
                copy["id"],
                state="deleted",
                retention=None,
                context=self._context(f"tombstone-{copy['id']}"),
            )
            repeated = self.bundle.connectors.privacy.tombstone_copy(
                copy["id"],
                state="deleted",
                retention=None,
                context=self._context(f"tombstone-{copy['id']}-retry"),
            )
            self.assertEqual(repeated, tombstone)
            self.assertEqual(tombstone["useState"], "deleted")
            self.assertEqual(tombstone["sourceTrainingExportId"], "export_contract")
            self.assertEqual(tombstone["permittingGrantIds"], ["grant_contract"])
            self.assertEqual(tombstone["evidenceDigests"], ["sha256:" + "b" * 64])
            self.assertNotIn("content", json.dumps(tombstone).lower())

        with self.assertRaises(ConnectorError) as taskset_missing:
            self.bundle.connectors.tasksets.resolve(
                registered.reference,
                self._context("resolve-deleted-taskset"),
            )
        self.assertEqual(taskset_missing.exception.category, "not_found")
        with self.assertRaises(ConnectorError) as candidate_missing:
            self.bundle.connectors.candidates.get(
                candidate.id,
                self._context("read-deleted-candidate"),
            )
        self.assertEqual(candidate_missing.exception.category, "not_found")

    def test_deletion_receipt_compare_and_swap_survives_restart(self):
        request_record = {
            "schemaVersion": "replica.runtime-deletion/v1",
            "id": "deletion_contract",
            "scope": {"tenantId": "tenant-one", "repository": "github/example"},
            "selectors": {"exportId": "export_contract"},
            "requestedBy": "privacy-operator",
            "reason": "consent withdrawn",
            "retention": None,
        }
        created = self.bundle.connectors.privacy.create_deletion(
            request_record,
            self._context("create-deletion", key="stable-deletion"),
        )
        retried = self.bundle.connectors.privacy.create_deletion(
            request_record,
            self._context("create-deletion-retry", key="stable-deletion"),
        )
        self.assertEqual(retried, created)
        other_request = {
            **request_record,
            "selectors": {"grantId": "grant_other"},
            "reason": "another withdrawal",
        }
        self.bundle.connectors.privacy.create_deletion(
            other_request,
            self._context("create-other-deletion", key="other-deletion"),
        )
        with self.assertRaises(ConnectorError) as reused:
            self.bundle.connectors.privacy.create_deletion(
                other_request,
                self._context("reuse-stable-deletion", key="stable-deletion"),
            )
        self.assertEqual(reused.exception.code, "idempotency_conflict")
        completed_record = dict(
            created,
            state="completed",
            revokedAt="2026-11-19T00:00:01Z",
            completedAt="2026-11-19T00:00:02Z",
            pendingItems=[],
        )
        completed = self.bundle.connectors.privacy.update_deletion(
            created["id"],
            completed_record,
            expected_version=created["version"],
            context=self._context("complete-deletion"),
        )
        with self.assertRaises(ConnectorError) as stale:
            self.bundle.connectors.privacy.update_deletion(
                created["id"],
                dict(completed_record, reason="changed"),
                expected_version=created["version"],
                context=self._context("stale-deletion-update"),
            )
        self.assertEqual(stale.exception.category, "conflict")
        self.bundle.close()

        reopened = create_local_connector_bundle(
            self.state_dir,
            self.taskset_dir,
            {"fixture": FixtureBackend()},
            scope=self.scope,
        )
        self.addCleanup(reopened.close)
        self.assertEqual(
            reopened.connectors.privacy.get_deletion(
                created["id"],
                self._context("read-deletion-after-restart"),
            ),
            completed,
        )
        self.assertIn(
            completed,
            reopened.connectors.privacy.list_deletions(
                ("completed",),
                self._context("list-deletions-after-restart"),
            ),
        )

    def _copy(
        self,
        copy_id,
        kind,
        taskset_digest,
        *,
        storage_reference=None,
    ):
        return {
            "schemaVersion": "replica.runtime-copy/v1",
            "id": copy_id,
            "kind": kind,
            "scope": {"tenantId": "tenant-one", "repository": "github/example"},
            "sourceTrainingExportId": "export_contract",
            "sourceTrainingExportDigest": "sha256:" + "d" * 64,
            "permittingGrantIds": ["grant_contract"],
            "permittedPurposes": ["training"],
            "reviewDigests": ["sha256:" + "c" * 64],
            "evidenceDigests": ["sha256:" + "b" * 64],
            "tasksetDigest": taskset_digest,
            "runtimeCopyId": copy_id,
            "storage": {
                "connector": "local-filesystem",
                "reference": storage_reference or copy_id,
            },
            "createdAt": "2026-11-19T00:00:00Z",
            "promotionState": "not_promoted",
            "useState": "active",
            "retention": {
                "policy": "delete_on_withdrawal",
                "expiresAt": "2026-12-19T00:00:00Z",
            },
            "parentRuntimeCopyIds": [],
        }

    def _context(self, operation_id, *, key=None, scope=None):
        return OperationContext(
            operation_id=operation_id,
            idempotency_key=key or operation_id,
            scope=scope or self.scope,
            owner=RuntimeOwner("worker", "deletion-conformance"),
            deadline=time.monotonic() + 5,
            cancellation=Cancellation(),
        )


if __name__ == "__main__":
    unittest.main()
