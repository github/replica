"""Durable filesystem coverage for the real local connector bundle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import time
import unittest
from pathlib import Path

from replica_brand_check.connector_conformance import (
    ConnectorConformanceFixture,
    connector_conformance,
)
from replica_brand_check.connectors import (
    Artifact,
    Candidate,
    Cancellation,
    ConnectorError,
    ContentDigest,
    OperationContext,
    RuntimeOwner,
    RuntimeScope,
    Usage,
)
from replica_brand_check.local_connectors import create_local_connector_bundle
from replica_brand_check.runtime import FixtureBackend
from tests.support import make_task, write_taskset


_RESOURCES = []


def _digest(data: bytes) -> ContentDigest:
    return ContentDigest("sha256", hashlib.sha256(data).hexdigest())


def _context(
    scope: RuntimeScope,
    operation_id: str,
) -> OperationContext:
    return OperationContext(
        operation_id=operation_id,
        idempotency_key=operation_id,
        scope=scope,
        owner=RuntimeOwner("worker", "local-connector-test"),
        deadline=time.monotonic() + 5,
        cancellation=Cancellation(),
    )


def _candidate(name: str) -> Candidate:
    artifact = Artifact(
        digest=_digest(name.encode()),
        media_type="application/octet-stream",
        data=name.encode(),
    )
    return Candidate(
        id=f"candidate_{name}",
        digest=_digest(f"candidate:{name}".encode()),
        manifest={"name": name, "artifact": str(artifact.digest)},
        artifacts=(artifact,),
    )


def _new_bundle(
    case: unittest.TestCase,
    *,
    scope: RuntimeScope | None = None,
):
    taskset_directory = write_taskset(
        case,
        [
            make_task(1, answer=True),
            make_task(2, split="test", answer=True),
        ],
    )
    state_directory = taskset_directory.parent / f"{taskset_directory.name}-state"
    case.addCleanup(shutil.rmtree, state_directory, True)
    selected_scope = scope or RuntimeScope("tenant-one", "github/example")
    bundle = create_local_connector_bundle(
        state_directory,
        taskset_directory,
        {"fixture": FixtureBackend()},
        scope=selected_scope,
    )
    case.addCleanup(bundle.close)
    return bundle, state_directory, selected_scope


def _conformance_fixture() -> ConnectorConformanceFixture:
    holder = tempfile.TemporaryDirectory()
    case = unittest.TestCase()
    taskset_directory = write_taskset(
        case,
        [
            make_task(1, answer=True),
            make_task(2, split="test", answer=True),
        ],
    )
    scope = RuntimeScope("tenant-one", "github/example")
    other_scope = RuntimeScope("tenant-two", "github/example")
    bundle = create_local_connector_bundle(
        Path(holder.name) / "state",
        taskset_directory,
        {"fixture": FixtureBackend()},
        scope=scope,
    )
    _RESOURCES.append((bundle, case, holder))
    return ConnectorConformanceFixture(
        connectors=bundle.connectors,
        scope=scope,
        other_scope=other_scope,
        taskset_reference=bundle.taskset_reference,
        usage=bundle.observability.records,
    )


def load_tests(loader, tests, pattern):
    del loader, pattern
    tests.addTests(connector_conformance("local-filesystem", _conformance_fixture))
    return tests


def tearDownModule():
    while _RESOURCES:
        bundle, case, holder = _RESOURCES.pop()
        bundle.close()
        case.doCleanups()
        holder.cleanup()


class LocalConnectorPersistenceTest(unittest.TestCase):
    def test_refuses_to_rebind_existing_state_to_another_scope(self):
        bundle, state_directory, scope = _new_bundle(self)
        taskset_directory = bundle.tasksets.taskset.directory
        bundle.close()

        with self.assertRaises(ConnectorError) as conflict:
            create_local_connector_bundle(
                state_directory,
                taskset_directory,
                {"fixture": FixtureBackend()},
                scope=RuntimeScope("another-tenant", scope.repository),
            )

        self.assertEqual(conflict.exception.category, "conflict")

    def test_reads_existing_single_node_state_and_adds_connector_metadata(self):
        taskset_directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        state_directory = (
            taskset_directory.parent / f"{taskset_directory.name}-legacy-state"
        )
        self.addCleanup(shutil.rmtree, state_directory, True)
        candidate_directory = state_directory / "candidates" / "candidate_legacy"
        candidate_directory.mkdir(parents=True)
        (candidate_directory / "adapter.json").write_text(
            '{"probabilities":{}}\n',
            encoding="utf-8",
        )
        (candidate_directory / "evaluation.json").write_text(
            '{"tasksetDigest":"sha256:legacy"}\n',
            encoding="utf-8",
        )
        (candidate_directory / "manifest.json").write_text(
            json.dumps(
                {
                    "id": "candidate_legacy",
                    "adapter": {"file": "adapter.json"},
                }
            ),
            encoding="utf-8",
        )
        jobs = state_directory / "jobs"
        jobs.mkdir()
        (jobs / "job_legacy.json").write_text(
            '{"id":"job_legacy","state":"succeeded"}\n',
            encoding="utf-8",
        )
        promotions = state_directory / "promotions"
        promotions.mkdir()
        promotion = {
            "schemaVersion": "replica.decision-promotion/v1",
            "generation": 1,
            "candidateId": "candidate_legacy",
            "previousCandidateId": None,
            "operation": "promote",
            "promotedBy": "legacy-operator",
            "promotedAt": "2026-11-10T00:00:00.000000Z",
        }
        promotion_bytes = (json.dumps(promotion, sort_keys=True, separators=(",", ":")) + "\n")
        (promotions / "00000001.json").write_text(promotion_bytes, encoding="utf-8")
        (state_directory / "promotion.json").write_text(
            promotion_bytes,
            encoding="utf-8",
        )
        scope = RuntimeScope("tenant-one", "github/example")

        bundle = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": FixtureBackend()},
            scope=scope,
        )
        self.addCleanup(bundle.close)

        job = bundle.connectors.jobs.get("job_legacy", _context(scope, "legacy-job"))
        candidate = bundle.connectors.candidates.get(
            "candidate_legacy",
            _context(scope, "legacy-candidate"),
        )
        current = bundle.connectors.candidates.current(
            _context(scope, "legacy-promotion")
        )
        self.assertEqual(job["version"], 1)
        self.assertEqual(
            {artifact.metadata["name"] for artifact in candidate.artifacts},
            {"adapter.json", "evaluation.json"},
        )
        self.assertEqual(current.owner, RuntimeOwner("human", "legacy-operator"))
        self.assertTrue((candidate_directory / ".candidate.json").is_file())
        self.assertTrue((state_directory / ".scope.json").is_file())

    def test_recovers_scoped_state_and_usage_after_restart(self):
        bundle, state_directory, scope = _new_bundle(self)
        context = _context(scope, "persist")
        artifact = Artifact(
            digest=_digest(b"private artifact"),
            media_type="application/octet-stream",
            data=b"private artifact",
            metadata={"purpose": "test"},
        )
        bundle.connectors.artifacts.put(artifact, context)
        created = bundle.connectors.jobs.create(
            "job_restart",
            {"state": "queued", "backend": "fixture"},
            context,
        )
        running = bundle.connectors.jobs.update(
            "job_restart",
            {"state": "running", "backend": "fixture"},
            expected_version=created["version"],
            context=context,
        )
        candidate = bundle.connectors.candidates.put(_candidate("restart"), context)
        promotion = bundle.connectors.candidates.promote(
            candidate.id,
            expected_generation=0,
            operation="promote",
            context=context,
        )
        usage = Usage(
            operation_id=context.operation_id,
            scope=scope,
            connector="fixture",
            kind="training_updates",
            quantity=2,
            unit="updates",
            cost=0.02,
            currency="USD",
        )
        bundle.connectors.observability.record(usage, context)
        reference = bundle.taskset_reference
        taskset_directory = bundle.tasksets.taskset.directory
        with self.assertRaises(ConnectorError) as in_use:
            create_local_connector_bundle(
                state_directory,
                taskset_directory,
                {"fixture": FixtureBackend()},
                scope=scope,
            )
        self.assertEqual(in_use.exception.category, "conflict")
        bundle.close()

        reopened = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": FixtureBackend()},
            scope=scope,
        )
        self.addCleanup(reopened.close)

        self.assertEqual(
            reopened.connectors.tasksets.resolve(
                reference, _context(scope, "resolve")
            ).reference,
            reference,
        )
        self.assertEqual(
            reopened.connectors.artifacts.get(
                artifact.digest, _context(scope, "artifact")
            ),
            artifact,
        )
        self.assertEqual(
            reopened.connectors.jobs.get("job_restart", _context(scope, "job")),
            running,
        )
        self.assertEqual(
            reopened.connectors.candidates.get(
                candidate.id, _context(scope, "candidate")
            ),
            candidate,
        )
        self.assertEqual(
            reopened.connectors.candidates.current(_context(scope, "promotion")),
            promotion,
        )
        self.assertEqual(reopened.observability.records(), (usage,))

    def test_keeps_scoped_files_private_and_detects_artifact_tampering(self):
        bundle, state_directory, scope = _new_bundle(self)
        artifact = Artifact(
            digest=_digest(b"tamper target"),
            media_type="application/octet-stream",
            data=b"tamper target",
        )
        bundle.connectors.artifacts.put(artifact, _context(scope, "store"))

        paths = tuple(state_directory.rglob("*"))
        self.assertTrue(paths)
        self.assertTrue(all(path.is_relative_to(state_directory) for path in paths))
        self.assertFalse(
            any(
                scope.tenant_id in path.relative_to(state_directory).as_posix()
                or scope.repository in path.relative_to(state_directory).as_posix()
                for path in paths
            )
        )
        for path in (state_directory, *paths):
            mode = path.stat().st_mode
            self.assertEqual(mode & 0o077, 0, path)

        matches = [
            path
            for path in paths
            if path.is_file() and path.name == artifact.digest.value
        ]
        self.assertEqual(len(matches), 1)
        os.chmod(matches[0], 0o600)
        matches[0].write_bytes(b"changed")

        with self.assertRaises(ConnectorError) as damaged:
            bundle.connectors.artifacts.get(
                artifact.digest, _context(scope, "read-tampered")
            )

        self.assertEqual(damaged.exception.category, "integrity")

    def test_detects_candidate_manifest_tampering(self):
        bundle, state_directory, scope = _new_bundle(self)
        candidate = bundle.connectors.candidates.put(
            _candidate("tampered"), _context(scope, "candidate")
        )
        manifest_path = state_directory / "candidates" / candidate.id / "manifest.json"
        os.chmod(manifest_path, 0o600)
        manifest_path.write_text('{"name":"changed"}\n', encoding="utf-8")

        with self.assertRaises(ConnectorError) as candidate_damaged:
            bundle.connectors.candidates.get(
                candidate.id, _context(scope, "read-candidate")
            )

        self.assertEqual(candidate_damaged.exception.category, "integrity")

    def test_recovers_a_complete_promotion_generation_after_pointer_write_loss(self):
        bundle, state_directory, scope = _new_bundle(self)
        taskset_directory = bundle.tasksets.taskset.directory
        first = bundle.connectors.candidates.put(
            _candidate("first"), _context(scope, "first-candidate")
        )
        second = bundle.connectors.candidates.put(
            _candidate("second"), _context(scope, "second-candidate")
        )
        first_promotion = bundle.connectors.candidates.promote(
            first.id,
            expected_generation=0,
            operation="promote",
            context=_context(scope, "first-promotion"),
        )
        second_promotion = bundle.connectors.candidates.promote(
            second.id,
            expected_generation=1,
            operation="promote",
            context=_context(scope, "second-promotion"),
        )
        bundle.close()
        pointer = state_directory / "promotion.json"
        os.chmod(pointer, 0o600)
        pointer.write_bytes(
            (state_directory / "promotions" / "00000001.json").read_bytes()
        )

        reopened = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": FixtureBackend()},
            scope=scope,
        )
        self.addCleanup(reopened.close)

        self.assertEqual(
            reopened.connectors.candidates.current(
                _context(scope, "recovered-promotion")
            ),
            second_promotion,
        )
        self.assertNotEqual(first_promotion, second_promotion)


if __name__ == "__main__":
    unittest.main()
