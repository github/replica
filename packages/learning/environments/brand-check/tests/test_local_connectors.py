"""Durable filesystem coverage for the real local connector bundle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
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
    TrainingResult,
    Usage,
)
from replica_brand_check.local_connectors import create_local_connector_bundle
from tests.support import make_task, taskset_bundle, write_taskset


_RESOURCES = []


class _CleanupSuite(unittest.TestSuite):
    def run(self, result, debug=False):
        try:
            return super().run(result, debug)
        finally:
            _cleanup_resources()


class _FixtureBackend:
    name = "fixture"
    production_eligible = False

    def train(self, *args, **kwargs):
        return TrainingResult(
            adapter_name="adapter.bin",
            adapter=b"adapter",
            baseline_report={"meanReward": 0.5},
            candidate_report={"meanReward": 0.75},
            metadata={},
            updates_completed=kwargs["max_updates"],
        )

    def predict(self, *args, **kwargs):
        raise AssertionError("context-aware inference should use predict_with_context")

    def predict_with_context(self, *args, **kwargs):
        return {"operationId": kwargs["context"].operation_id}


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
        {"fixture": _FixtureBackend()},
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
    other_repository_scope = RuntimeScope("tenant-one", "github/other")
    other_tenant_scope = RuntimeScope("tenant-two", "github/example")
    bundle = create_local_connector_bundle(
        Path(holder.name) / "state",
        taskset_directory,
        {"fixture": _FixtureBackend()},
        scope=scope,
    )
    _RESOURCES.append((bundle, case, holder))
    return ConnectorConformanceFixture(
        connectors=bundle.connectors,
        scope=scope,
        other_repository_scope=other_repository_scope,
        other_tenant_scope=other_tenant_scope,
        taskset_bundle=taskset_bundle(taskset_directory),
        taskset_digest=bundle.taskset_digest,
        taskset_reference=bundle.taskset_reference,
        usage=bundle.observability.records,
    )


def load_tests(loader, tests, pattern):
    del loader, pattern
    tests.addTests(connector_conformance("local-filesystem", _conformance_fixture))
    return _CleanupSuite(tests)


def tearDownModule():
    _cleanup_resources()


def _cleanup_resources():
    while _RESOURCES:
        bundle, case, holder = _RESOURCES.pop()
        bundle.close()
        case.doCleanups()
        holder.cleanup()


class LocalConnectorPersistenceTest(unittest.TestCase):
    def test_registered_taskset_survives_reopening_the_local_bundle(self):
        bundle, state_directory, scope = _new_bundle(self)
        startup_directory = bundle.tasksets.taskset.directory
        registered = bundle.connectors.tasksets.register(
            taskset_bundle(startup_directory),
            _context(scope, "register-taskset"),
        )
        self.assertNotEqual(registered.reference, "")
        bundle.close()

        reopened = create_local_connector_bundle(
            state_directory,
            startup_directory,
            {"fixture": _FixtureBackend()},
            scope=scope,
        )
        self.addCleanup(reopened.close)

        resolved = reopened.connectors.tasksets.resolve(
            registered.reference,
            _context(scope, "resolve-registered-taskset"),
        )
        self.assertEqual(resolved.digest, registered.digest)
        self.assertEqual(
            [task.id for task in resolved.taskset.tasks],
            [task.id for task in registered.taskset.tasks],
        )

    def test_refuses_to_mint_credentials_for_another_scope(self):
        bundle, _, scope = _new_bundle(self)

        with self.assertRaises(ConnectorError) as refused:
            bundle.connectors.credentials.acquire(
                "training",
                _context(
                    RuntimeScope("another-tenant", scope.repository),
                    "cross-scope-credential",
                ),
            )

        self.assertEqual(refused.exception.category, "unauthorized")

    def test_refuses_identifiers_that_escape_private_storage(self):
        bundle, state_directory, scope = _new_bundle(self)
        context = _context(scope, "unsafe-identifiers")

        with self.assertRaises(ConnectorError) as job_error:
            bundle.connectors.jobs.create(
                "../escaped",
                {"state": "queued"},
                context,
            )
        with self.assertRaises(ConnectorError) as candidate_error:
            bundle.connectors.candidates.put(
                Candidate(
                    id="../escaped",
                    digest=_digest(b"candidate"),
                    manifest={"name": "escaped"},
                    artifacts=(
                        Artifact(
                            digest=_digest(b"artifact"),
                            media_type="application/octet-stream",
                            data=b"artifact",
                        ),
                    ),
                ),
                context,
            )

        self.assertEqual(job_error.exception.category, "invalid_input")
        self.assertEqual(candidate_error.exception.category, "invalid_input")
        self.assertFalse((state_directory / "escaped.json").exists())
        self.assertFalse((state_directory / "escaped").exists())

    def test_lists_every_valid_local_job_identifier(self):
        bundle, _, scope = _new_bundle(self)
        context = _context(scope, "list-job")
        created = bundle.connectors.jobs.create(
            "custom-job",
            {"state": "queued"},
            context,
        )

        self.assertIn(
            created,
            bundle.connectors.jobs.list(("queued",), context),
        )

    def test_completes_metadata_after_an_interrupted_artifact_write(self):
        bundle, state_directory, scope = _new_bundle(self)
        artifact = Artifact(
            digest=_digest(b"recoverable"),
            media_type="application/octet-stream",
            data=b"recoverable",
            metadata={"purpose": "test"},
        )
        data_path = (
            state_directory
            / "artifacts"
            / "sha256"
            / artifact.digest.value[:2]
            / artifact.digest.value
        )
        data_path.parent.mkdir(parents=True)
        data_path.write_bytes(artifact.data)

        stored = bundle.connectors.artifacts.put(
            artifact,
            _context(scope, "recover-artifact"),
        )

        self.assertEqual(stored, artifact)
        self.assertEqual(
            bundle.connectors.artifacts.get(
                artifact.digest,
                _context(scope, "read-recovered-artifact"),
            ),
            artifact,
        )

    def test_rejects_non_finite_lease_lifetimes_without_writing_a_lease(self):
        bundle, state_directory, scope = _new_bundle(self)
        context = _context(scope, "lease-lifetime")
        bundle.connectors.jobs.create("job_infinite", {"state": "queued"}, context)

        with self.assertRaises(ConnectorError) as invalid:
            bundle.connectors.jobs.acquire(
                "job_infinite",
                ttl_seconds=float("inf"),
                context=context,
            )

        self.assertEqual(invalid.exception.category, "invalid_input")
        self.assertFalse(
            (state_directory / "jobs" / ".leases" / "job_infinite.json").exists()
        )

    def test_accepts_an_identical_candidate_with_list_artifacts(self):
        bundle, _, scope = _new_bundle(self)
        context = _context(scope, "candidate-list")
        original = _candidate("list")
        candidate = Candidate(
            original.id,
            original.digest,
            original.manifest,
            list(original.artifacts),
        )

        bundle.connectors.candidates.put(candidate, context)
        retried = bundle.connectors.candidates.put(candidate, context)

        self.assertEqual(tuple(retried.artifacts), tuple(candidate.artifacts))

    def test_refuses_to_rebind_existing_state_to_another_scope(self):
        bundle, state_directory, scope = _new_bundle(self)
        taskset_directory = bundle.tasksets.taskset.directory
        bundle.close()

        with self.assertRaises(ConnectorError) as conflict:
            create_local_connector_bundle(
                state_directory,
                taskset_directory,
                {"fixture": _FixtureBackend()},
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
        promotion_bytes = (
            json.dumps(promotion, sort_keys=True, separators=(",", ":")) + "\n"
        )
        (promotions / "00000001.json").write_text(promotion_bytes, encoding="utf-8")
        (state_directory / "promotion.json").write_text(
            promotion_bytes,
            encoding="utf-8",
        )
        scope = RuntimeScope("tenant-one", "github/example")

        bundle = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": _FixtureBackend()},
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

    def test_serializes_concurrent_legacy_candidate_migration(self):
        taskset_directory = write_taskset(
            self,
            [
                make_task(1, answer=True),
                make_task(2, split="test", answer=True),
            ],
        )
        state_directory = taskset_directory.parent / "concurrent-legacy-state"
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
            '{"id":"candidate_legacy","adapter":{"file":"adapter.json"}}\n',
            encoding="utf-8",
        )
        scope = RuntimeScope("tenant-one", "github/example")
        bundle = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": _FixtureBackend()},
            scope=scope,
        )
        self.addCleanup(bundle.close)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = tuple(
                executor.map(
                    lambda operation: bundle.connectors.candidates.get(
                        "candidate_legacy",
                        _context(scope, operation),
                    ),
                    ("legacy-one", "legacy-two"),
                )
            )

        self.assertEqual(results[0], results[1])

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
        lease = bundle.connectors.jobs.acquire(
            "job_restart",
            ttl_seconds=30,
            context=context,
        )
        running = bundle.connectors.jobs.update(
            "job_restart",
            {"state": "running", "backend": "fixture"},
            expected_version=created["version"],
            lease=lease,
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
                {"fixture": _FixtureBackend()},
                scope=scope,
            )
        self.assertEqual(in_use.exception.category, "conflict")
        bundle.close()

        reopened = create_local_connector_bundle(
            state_directory,
            taskset_directory,
            {"fixture": _FixtureBackend()},
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

    def test_classifies_malformed_candidate_artifact_metadata_as_integrity_damage(self):
        bundle, state_directory, scope = _new_bundle(self)
        candidate = bundle.connectors.candidates.put(
            _candidate("malformed"), _context(scope, "candidate")
        )
        descriptor_path = (
            state_directory / "candidates" / candidate.id / ".candidate.json"
        )
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        descriptor["artifacts"][0]["mediaType"] = 7
        os.chmod(descriptor_path, 0o600)
        descriptor_path.write_text(json.dumps(descriptor), encoding="utf-8")

        with self.assertRaises(ConnectorError) as candidate_damaged:
            bundle.connectors.candidates.get(
                candidate.id, _context(scope, "read-malformed-candidate")
            )

        self.assertEqual(candidate_damaged.exception.category, "integrity")

    def test_detects_coherent_candidate_content_replacement(self):
        bundle, state_directory, scope = _new_bundle(self)
        candidate = bundle.connectors.candidates.put(
            _candidate("coherent"), _context(scope, "candidate")
        )
        directory = state_directory / "candidates" / candidate.id
        descriptor_path = directory / ".candidate.json"
        descriptor = json.loads(descriptor_path.read_text(encoding="utf-8"))
        manifest = {"name": "changed", "artifact": str(_digest(b"changed"))}
        artifact = descriptor["artifacts"][0]
        artifact_path = directory / artifact["name"]
        os.chmod(artifact_path, 0o600)
        artifact_path.write_bytes(b"changed")
        artifact["digest"] = str(_digest(b"changed"))
        manifest_path = directory / "manifest.json"
        os.chmod(manifest_path, 0o600)
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        descriptor["manifestDigest"] = str(
            _digest(
                (
                    json.dumps(manifest, sort_keys=True, separators=(",", ":"))
                    + "\n"
                ).encode()
            )
        )
        os.chmod(descriptor_path, 0o600)
        descriptor_path.write_text(
            json.dumps(descriptor, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

        with self.assertRaises(ConnectorError) as candidate_damaged:
            bundle.connectors.candidates.get(
                candidate.id,
                _context(scope, "read-replaced-candidate"),
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
            {"fixture": _FixtureBackend()},
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
