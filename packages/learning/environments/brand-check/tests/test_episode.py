import base64
import unittest

from replica_brand_check.episode import EpisodeError, Episodes, ResetError
from replica_brand_check.taskset import load_taskset

from tests.support import PNG, RULE, make_task, task_id, write_taskset


class EpisodesTest(unittest.TestCase):
    def test_seeded_reset_draws_the_same_task(self):
        taskset = load_taskset(write_taskset(self, [make_task(n) for n in range(1, 9)]))

        drawn = {Episodes(taskset).reset(seed=11)["task_id"] for _ in range(5)}

        self.assertEqual(len(drawn), 1)

    def test_reset_shows_the_task_without_labels(self):
        task = make_task(1)

        observation = Episodes(load_taskset(write_taskset(self, [task]))).reset()

        self.assertEqual(
            observation,
            {
                "task_id": task_id(1),
                "split": "train",
                "state": task["state"],
                "images": ["data:image/png;base64," + base64.b64encode(PNG).decode("ascii")],
                "questions": task["questions"],
            },
        )

    def test_step_scores_each_labeled_question(self):
        task = make_task(1, answer=False)
        task["questions"]["most_clearly_broken"] = {
            "type": "choice",
            "instructions": "Which team learning does the candidate break most clearly?",
            "criteria": {"none": "It breaks none of them", RULE: "Put a visible label above."},
        }
        task["questions"]["severity"] = {
            "type": "score",
            "instructions": "How far is the candidate from the team learnings?",
            "criteria": ["Follows them", "Minor slip", "Clear violation", "Severe violation"],
        }
        task["labels"]["most_clearly_broken"] = {"answer": RULE}
        episodes = Episodes(load_taskset(write_taskset(self, [task])))
        episodes.reset()

        outcome = episodes.step(
            {
                RULE: {"probabilities": {"yes": 0.2, "no": 0.8}},
                "most_clearly_broken": {"probabilities": {"none": 0.5, "other": 0.5}},
                "severity": {"probabilities": {"0": 1.0}},
            }
        )

        # 1 - 0.2^2 for the noul answer; the choice answer names an unknown option, so it earns 0.
        self.assertAlmostEqual(outcome.reward, 0.96 / 2)
        self.assertAlmostEqual(outcome.metadata["rewards"][RULE], 0.96)
        self.assertEqual(outcome.metadata["rewards"]["most_clearly_broken"], 0.0)
        self.assertEqual(outcome.metadata["correct"], {RULE: True, "most_clearly_broken": False})
        self.assertEqual(outcome.metadata["invalid"], ["most_clearly_broken"])
        self.assertEqual(outcome.metadata["labels"], {RULE: False, "most_clearly_broken": RULE})

    def test_step_before_reset_fails(self):
        episodes = Episodes(load_taskset(write_taskset(self, [make_task(1)])))

        with self.assertRaisesRegex(EpisodeError, "call reset before step"):
            episodes.step({})

    def test_second_step_fails(self):
        episodes = Episodes(load_taskset(write_taskset(self, [make_task(1)])))
        episodes.reset()
        episodes.step({})

        with self.assertRaisesRegex(EpisodeError, "already done"):
            episodes.step({})

    def test_reset_refuses_an_unknown_task_or_an_empty_split(self):
        episodes = Episodes(load_taskset(write_taskset(self, [make_task(1)])))

        with self.assertRaisesRegex(ResetError, "Unknown task_id"):
            episodes.reset(task_id=task_id(2))
        with self.assertRaisesRegex(ResetError, "Split test has no tasks"):
            episodes.reset(split="test")
