import math
import unittest

from replica_brand_check.scoring import choice_reward, normalize, noul_reward, score_reward


class ProperScoringRuleTest(unittest.TestCase):
    def test_noul_reward_is_one_minus_the_squared_error(self):
        self.assertEqual(noul_reward(1.0, True), 1.0)
        self.assertEqual(noul_reward(0.5, True), 0.75)
        self.assertEqual(noul_reward(0.5, False), 0.75)
        self.assertAlmostEqual(noul_reward(0.8, False), 0.36)

    def test_choice_reward_is_one_minus_half_the_brier_score(self):
        self.assertEqual(choice_reward({"none": 0.0, "a": 1.0, "b": 0.0}, "a"), 1.0)
        # 1 - 0.5 * ((0.5 - 1)^2 + 0.3^2 + 0.2^2) = 1 - 0.5 * 0.38
        self.assertAlmostEqual(choice_reward({"none": 0.3, "a": 0.5, "b": 0.2}, "a"), 0.81)
        self.assertEqual(choice_reward({"none": 1.0, "a": 0.0}, "a"), 0.0)

    def test_score_reward_is_one_minus_the_ranked_probability_score(self):
        self.assertEqual(score_reward([0.0, 1.0, 0.0, 0.0], 1), 1.0)
        # Cumulative probabilities 0.1, 0.3, 0.6 against 0, 1, 1: RPS = (0.01 + 0.49 + 0.16) / 3.
        self.assertAlmostEqual(score_reward([0.1, 0.2, 0.3, 0.4], 1), 0.78)


class NormalizeTest(unittest.TestCase):
    def test_refuses_invalid_probabilities(self):
        cases = {
            "unknown option": {"yes": 0.5, "maybe": 0.5},
            "negative value": {"yes": 1.5, "no": -0.5},
            "NaN": {"yes": math.nan, "no": 1.0},
            "sum of 0.9": {"yes": 0.4, "no": 0.5},
            "boolean value": {"yes": True},
            "values too large to add": {"yes": 1e308, "no": 1e308},
        }
        for name, probabilities in cases.items():
            with self.subTest(name):
                self.assertIsNone(normalize(probabilities, ("yes", "no")))

    def test_renormalizes_a_sum_within_the_tolerance(self):
        distribution = normalize({"yes": 0.6, "no": 0.4005}, ("yes", "no"))
        self.assertAlmostEqual(distribution["yes"], 0.6 / 1.0005)
        self.assertAlmostEqual(math.fsum(distribution.values()), 1.0, places=12)

    def test_counts_a_missing_option_as_zero(self):
        self.assertEqual(normalize({"yes": 1.0}, ("yes", "no")), {"yes": 1.0, "no": 0.0})
