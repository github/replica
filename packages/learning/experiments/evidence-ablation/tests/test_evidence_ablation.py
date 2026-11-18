from __future__ import annotations

import copy
import json
import shutil
import unittest
from pathlib import Path

from evidence_ablation import (
    ExperimentError,
    load_taskset,
    proposal_set,
    run_experiment,
    split_plan,
    validate_corpus,
    validate_manifest,
    write_taskset,
)


HERE = Path(__file__).resolve().parent
EXPERIMENT = HERE.parent
FIXTURE = EXPERIMENT / "fixtures" / "synthetic"
CREATED_AT = "2026-11-18T00:00:00Z"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def task_labels(taskset) -> dict[tuple[str, int, str], dict[str, bool]]:
    return {
        (
            task.provenance["prototypeId"],
            task.provenance["buildNumber"],
            task.provenance["route"],
        ): dict(task.labels)
        for task in taskset.tasks
    }


class EvidenceAblationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.work = HERE / ".work" / self._testMethodName
        shutil.rmtree(self.work, ignore_errors=True)
        self.work.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.work, ignore_errors=True)
        parent = self.work.parent
        if parent.exists() and not any(parent.iterdir()):
            parent.rmdir()

    def test_synthetic_fixture_runs_cumulative_tiers_without_leaking_report_content(self) -> None:
        corpus = read_json(FIXTURE / "corpus.json")
        manifest = read_json(FIXTURE / "experiment.json")

        report = run_experiment(FIXTURE / "experiment.json", self.work / "results")

        self.assertEqual(list(report["tiers"]), ["A", "B", "C"])
        expected_split = split_plan(corpus, manifest["split"]).by_prototype
        tier_tasksets = {
            tier: load_taskset(self.work / "results" / f"tier-{tier.lower()}" / "taskset")
            for tier in ("A", "B", "C")
        }
        for tier, taskset in tier_tasksets.items():
            result = report["tiers"][tier]
            self.assertEqual(result["taskset"]["roundTripTasks"], len(taskset.tasks))
            self.assertEqual(result["taskset"]["counts"]["tasks"], len(taskset.tasks))
            for task in taskset.tasks:
                self.assertEqual(
                    task.split,
                    expected_split[task.provenance["prototypeId"]],
                )

        coverage = [report["tiers"][tier]["coverage"] for tier in ("A", "B", "C")]
        self.assertEqual([item["comments"] for item in coverage], [coverage[0]["comments"]] * 3)
        self.assertEqual(
            [item["outcomes"] for item in coverage],
            [0, coverage[1]["outcomes"], coverage[1]["outcomes"]],
        )
        self.assertGreater(coverage[1]["outcomes"], 0)
        self.assertEqual([item["actions"] for item in coverage[:2]], [0, 0])
        self.assertGreater(coverage[2]["actions"], 0)

        rendered_report = (
            (self.work / "results" / "report.json").read_text(encoding="utf-8")
            + (self.work / "results" / "report.md").read_text(encoding="utf-8")
        )
        forbidden = {
            corpus["source"]["repositoryScope"],
            *(learning["id"] for learning in corpus["learnings"]),
            *(learning["text"] for learning in corpus["learnings"]),
            *(prototype["id"] for prototype in corpus["prototypes"]),
            *(prototype["repositoryId"] for prototype in corpus["prototypes"]),
        }
        for prototype in corpus["prototypes"]:
            for thread in prototype["tierA"]["reviewThreads"]:
                for comment in thread["comments"]:
                    if comment["body"]:
                        forbidden.add(comment["body"])
                    forbidden.add(comment["actor"]["id"])
            for outcome in prototype["tierB"]["outcomes"]:
                for event in outcome["events"]:
                    forbidden.add(event["actor"]["id"])
            for session in prototype["tierC"]["authoringSessions"]:
                forbidden.add(session["prompt"])
        for value in forbidden:
            with self.subTest(value=value):
                self.assertNotIn(value, rendered_report)
        self.assertEqual(
            manifest["privacy"],
            {"reportIdentifiers": "digests-only", "includeRawContent": False},
        )

        f1 = [report["tiers"][tier]["proposalQuality"]["f1"] for tier in ("A", "B", "C")]
        reward = [
            report["tiers"][tier]["decisionModel"]["candidateMeanReward"]
            for tier in ("A", "B", "C")
        ]
        calibration = [
            report["tiers"][tier]["decisionModel"]["candidateCalibrationError"]
            for tier in ("A", "B", "C")
        ]
        self.assertLess(f1[0], f1[1])
        self.assertLess(f1[1], f1[2])
        self.assertLess(reward[0], reward[1])
        self.assertLess(reward[1], reward[2])
        self.assertGreater(calibration[0], calibration[1])
        self.assertGreater(calibration[1], calibration[2])

    def test_validation_rejects_deleted_comment_text(self) -> None:
        corpus = read_json(FIXTURE / "corpus.json")
        deleted = corpus["prototypes"][2]["tierA"]["reviewThreads"][0]["comments"][-1]
        self.assertIn("deletedAt", deleted)
        deleted["body"] = "Text that should have been removed."

        with self.assertRaisesRegex(ExperimentError, "must not retain its body"):
            validate_corpus(corpus)

    def test_repository_split_requires_three_boundaries(self) -> None:
        corpus = read_json(FIXTURE / "corpus.json")
        settings = copy.deepcopy(read_json(FIXTURE / "experiment.json")["split"])
        settings["unit"] = "repository"

        with self.assertRaisesRegex(
            ExperimentError, "repository split needs at least three distinct boundaries"
        ):
            split_plan(corpus, settings)

    def test_train_tasks_ignore_future_evaluation_labels(self) -> None:
        corpus = read_json(FIXTURE / "corpus.json")
        manifest = read_json(FIXTURE / "experiment.json")
        plan = split_plan(corpus, manifest["split"])
        proposals = proposal_set(corpus, "C", plan, manifest["budgets"])
        write_taskset(
            self.work / "baseline",
            corpus,
            "C",
            plan,
            proposals,
            manifest["budgets"],
            CREATED_AT,
        )
        baseline = load_taskset(self.work / "baseline")

        mutated = copy.deepcopy(corpus)
        train_id = next(
            prototype_id
            for prototype_id, split in plan.by_prototype.items()
            if split == "train"
        )
        held_out_id = next(
            prototype_id
            for prototype_id, split in plan.by_prototype.items()
            if split != "train"
        )
        for prototype in mutated["prototypes"]:
            if prototype["id"] in (train_id, held_out_id):
                for label in prototype["evaluation"]["buildLabels"]:
                    label["follows"] = not label["follows"]

        self.assertEqual(
            proposal_set(mutated, "C", plan, manifest["budgets"]),
            proposals,
        )
        write_taskset(
            self.work / "mutated",
            mutated,
            "C",
            plan,
            proposals,
            manifest["budgets"],
            CREATED_AT,
        )
        changed = load_taskset(self.work / "mutated")
        baseline_labels = task_labels(baseline)
        changed_labels = task_labels(changed)

        train_keys = [key for key in baseline_labels if key[0] == train_id]
        self.assertTrue(train_keys)
        for key in train_keys:
            self.assertEqual(changed_labels[key], baseline_labels[key])

        held_out_tasks = [
            task for task in changed.tasks if task.provenance["prototypeId"] == held_out_id
        ]
        self.assertTrue(held_out_tasks)
        held_out_prototype = next(
            prototype
            for prototype in mutated["prototypes"]
            if prototype["id"] == held_out_id
        )
        evaluation = {
            (label["buildNumber"], label["route"], label["learningId"]): label["follows"]
            for label in held_out_prototype["evaluation"]["buildLabels"]
        }
        for task in held_out_tasks:
            for learning_id, answer in task.labels.items():
                self.assertEqual(
                    answer,
                    evaluation[
                        (
                            task.provenance["buildNumber"],
                            task.provenance["route"],
                            learning_id,
                        )
                    ],
                )
        self.assertTrue(
            any(
                changed_labels[key] != baseline_labels[key]
                for key in changed_labels
                if key[0] == held_out_id
            )
        )

    def test_manifest_requires_an_explicit_corpus_path(self) -> None:
        manifest = read_json(FIXTURE / "experiment.json")
        manifest["corpus"] = ""
        with self.assertRaisesRegex(ExperimentError, "corpus"):
            validate_manifest(manifest)

    def test_corpus_requires_purpose_consent_and_retention_metadata(self) -> None:
        required_paths = (
            ("purpose",),
            ("purpose", "consentRecordedAt"),
            ("purpose", "approvedBy"),
            ("purpose", "retention"),
            ("purpose", "retention", "owner"),
            ("purpose", "retention", "deleteBy"),
        )
        for path in required_paths:
            with self.subTest(path=path):
                corpus = read_json(FIXTURE / "corpus.json")
                target = corpus
                for name in path[:-1]:
                    target = target[name]
                del target[path[-1]]
                with self.assertRaises(ExperimentError):
                    validate_corpus(corpus)


if __name__ == "__main__":
    unittest.main()
