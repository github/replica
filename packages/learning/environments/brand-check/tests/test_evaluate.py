import contextlib
import io
import json
import unittest

from replica_brand_check.evaluate import main

from tests.support import RULE, make_task, task_id, write_taskset

OTHER_RULE = "mem_0123456789abcdef01234567"


def yes(p: float) -> dict:
    return {"probabilities": {"yes": p, "no": 1 - p}}


class EvaluateTest(unittest.TestCase):
    def test_reports_accuracy_calibration_and_level_error(self):
        labels = [True, False, False, True, False, True]
        tasks = [make_task(n, split="dev", answer=label) for n, label in enumerate(labels, 1)]
        tasks[0]["questions"][OTHER_RULE] = tasks[0]["questions"][RULE]
        tasks[0]["labels"][OTHER_RULE] = {"answer": False}
        for task, level in ((tasks[0], 1), (tasks[2], 3)):
            task["questions"]["severity"] = {
                "type": "score",
                "instructions": "How far is the candidate from the team learnings?",
                "criteria": ["Follows them", "Minor slip", "Clear violation", "Severe violation"],
            }
            task["labels"]["severity"] = {"answer": level}
        directory = write_taskset(self, tasks)
        severity = {"0": 0.125, "1": 0.25, "2": 0.25, "3": 0.375}
        answers = [
            {RULE: yes(0.875), OTHER_RULE: yes(0.25), "severity": {"probabilities": severity}},
            {RULE: yes(0.75)},
            {RULE: yes(0.375), "severity": {"probabilities": {"2": 0.5, "3": 0.5}}},
            {RULE: {"probabilities": {"yes": 0.5}}},
            {RULE: yes(0.125)},
        ]
        predictions = directory / "predictions.jsonl"
        predictions.write_text(
            "".join(
                json.dumps({"taskId": task_id(n), "answers": answer}) + "\n"
                for n, answer in enumerate(answers, 1)
            ),
            encoding="utf-8",
        )

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = main(["--taskset", str(directory), "--predictions", str(predictions)])

        self.assertEqual(status, 0)
        report = json.loads(output.getvalue())
        self.assertEqual((report["split"], report["tasks"], report["missingTasks"]), ("dev", 6, 1))
        noul = report["noul"]
        self.assertEqual((noul["count"], noul["yes"], noul["no"], noul["invalid"]), (6, 2, 4, 1))
        self.assertAlmostEqual(noul["accuracy"], 4 / 6)
        # Recall is 1/2 on true labels and 3/4 on false labels.
        self.assertAlmostEqual(noul["balancedAccuracy"], 0.625)
        # Confidence 0.875 is right twice, 0.75 right once and wrong once, and 0.625 right once.
        self.assertAlmostEqual(noul["ece"], 2 / 5 * 0.125 + 2 / 5 * 0.25 + 1 / 5 * 0.375)
        self.assertEqual(noul["byRule"][OTHER_RULE], {"count": 1, "balancedAccuracy": None})
        # Expected levels are 1.875 against label 1 and 2.5 against label 3.
        self.assertAlmostEqual(report["score"]["meanAbsoluteError"], (0.875 + 0.5) / 2)
        self.assertIsNone(report["choice"]["accuracy"])
