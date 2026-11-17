"""Evaluation metrics over scored questions: accuracy, calibration, and proper scores.

Every reward is 1 minus a proper score (Brier for noul and choice, RPS for score), so the
scores here come from the same code that computes the environment's rewards.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from .scoring import QuestionResult

BINS = 10


def mean(values: Sequence[float]) -> float | None:
    """Return the mean, or None when there are no values."""
    return math.fsum(values) / len(values) if values else None


def balanced_accuracy(outcomes: Sequence[tuple[bool, bool]]) -> float | None:
    """Return the mean recall on true and on false labels, or None when either class is absent.

    Each outcome is a pair: the label, and whether the prediction matched it.
    """
    recalls = []
    for label in (True, False):
        matches = [matched for actual, matched in outcomes if actual == label]
        if not matches:
            return None
        recalls.append(sum(matches) / len(matches))
    return (recalls[0] + recalls[1]) / 2


def expected_calibration_error(points: Sequence[tuple[float, bool]]) -> float | None:
    """Return top-label ECE over 10 equal-width confidence bins, or None when there are no points.

    Each point is a pair: the confidence in the predicted option, and whether it was right.
    """
    if not points:
        return None
    bins: list[list[tuple[float, bool]]] = [[] for _ in range(BINS)]
    for confidence, right in points:
        bins[min(int(confidence * BINS), BINS - 1)].append((confidence, right))
    error = 0.0
    for members in bins:
        if members:
            accuracy = sum(right for _, right in members) / len(members)
            confidence = math.fsum(c for c, _ in members) / len(members)
            error += len(members) / len(points) * abs(accuracy - confidence)
    return error


def noul_report(results: Sequence[QuestionResult]) -> dict[str, Any]:
    """Return yes-or-no metrics. The prediction is yes when P(yes) is at least 0.5."""
    outcomes = []
    by_rule: dict[str, list[tuple[bool, bool]]] = {}
    points = []
    for result in results:
        matched = False
        if result.distribution is not None:
            p_yes = result.distribution["yes"]
            matched = (p_yes >= 0.5) == result.label
            points.append((p_yes if p_yes >= 0.5 else result.distribution["no"], matched))
        outcomes.append((result.label, matched))
        by_rule.setdefault(result.key, []).append((result.label, matched))
    yes = sum(1 for label, _ in outcomes if label)
    return {
        "count": len(results),
        "yes": yes,
        "no": len(results) - yes,
        "accuracy": mean([float(matched) for _, matched in outcomes]),
        "balancedAccuracy": balanced_accuracy(outcomes),
        "brier": mean(_losses(results)),
        "ece": expected_calibration_error(points),
        "invalid": _invalid(results),
        "byRule": {
            key: {"count": len(rule), "balancedAccuracy": balanced_accuracy(rule)}
            for key, rule in sorted(by_rule.items())
        },
    }


def choice_report(results: Sequence[QuestionResult]) -> dict[str, Any]:
    """Return choice metrics. The prediction is the single most probable option; a tie is wrong."""
    return {
        "count": len(results),
        "accuracy": mean([float(result.correct) for result in results]),
        "brier": mean(_losses(results)),
        "ece": expected_calibration_error(
            [
                (max(result.distribution.values()), result.correct)
                for result in results
                if result.distribution is not None
            ]
        ),
        "invalid": _invalid(results),
    }


def score_report(results: Sequence[QuestionResult]) -> dict[str, Any]:
    """Return score metrics. Accuracy needs a single most probable level, as for choice.

    The absolute error compares the label with the expected level, the sum of k * p_k.
    """
    errors = []
    for result in results:
        if result.distribution is not None:
            options = result.question.options
            expected = math.fsum(level * result.distribution[o] for level, o in enumerate(options))
            errors.append(abs(expected - result.label))
    return {
        "count": len(results),
        "accuracy": mean([float(result.correct) for result in results]),
        "rps": mean(_losses(results)),
        "meanAbsoluteError": mean(errors),
        "invalid": _invalid(results),
    }


def _losses(results: Sequence[QuestionResult]) -> list[float]:
    return [1.0 - result.reward for result in results if result.distribution is not None]


def _invalid(results: Sequence[QuestionResult]) -> int:
    return sum(1 for result in results if result.distribution is None)
