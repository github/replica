"""Check probability answers and score them with proper scoring rules.

A proper scoring rule gives the highest expected reward to the probabilities the model actually
believes, so reinforcement learning cannot buy reward by making the model overconfident.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .taskset import Question, Task

SUM_TOLERANCE = 1e-3


@dataclass(frozen=True)
class QuestionResult:
    """The score of one labeled question. distribution is None for a missing or invalid answer."""

    key: str
    question: Question
    label: Any
    distribution: Mapping[str, float] | None
    reward: float
    correct: bool


def normalize(probabilities: Any, options: Sequence[str]) -> dict[str, float] | None:
    """Return a distribution over every option that sums to 1, or None for invalid probabilities.

    Probabilities are valid when every key is an option, every value is a finite number from 0 to
    1, and the values sum to 1, each within SUM_TOLERANCE. A missing option counts as 0.
    """
    if not isinstance(probabilities, Mapping):
        return None
    values: dict[str, float] = {}
    for option, value in probabilities.items():
        if option not in options or isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        try:
            number = float(value)
        except OverflowError:
            return None
        # The upper bound also keeps the sum below from overflowing.
        if not math.isfinite(number) or not 0 <= number <= 1 + SUM_TOLERANCE:
            return None
        values[option] = number
    total = math.fsum(values.values())
    if abs(total - 1.0) > SUM_TOLERANCE:
        return None
    return {option: values.get(option, 0.0) / total for option in options}


def noul_reward(p_yes: float, answer: bool) -> float:
    """Return 1 - (p - y)^2, where p is the probability of yes and y is 1 for a true label."""
    return 1.0 - (p_yes - (1.0 if answer else 0.0)) ** 2


def choice_reward(distribution: Mapping[str, float], answer: str) -> float:
    """Return 1 minus half the multiclass Brier score; certainty in a wrong option earns 0."""
    return 1.0 - 0.5 * math.fsum(
        (p - (1.0 if option == answer else 0.0)) ** 2 for option, p in distribution.items()
    )


def score_reward(levels: Sequence[float], answer: int) -> float:
    """Return 1 - RPS, so probability near the labeled level costs less than far from it."""
    cumulative = 0.0
    squares = []
    for level in range(len(levels) - 1):
        cumulative += levels[level]
        squares.append((cumulative - (1.0 if level >= answer else 0.0)) ** 2)
    return 1.0 - math.fsum(squares) / (len(levels) - 1)


def question_reward(question: Question, distribution: Mapping[str, float], label: Any) -> float:
    """Return the reward, from 0 to 1, for one valid answer to a labeled question."""
    if question.type == "noul":
        reward = noul_reward(distribution["yes"], label)
    elif question.type == "choice":
        reward = choice_reward(distribution, label)
    else:
        reward = score_reward([distribution[option] for option in question.options], label)
    # Float rounding can move a reward a few ulps outside [0, 1]; the declared range is exact.
    return min(1.0, max(0.0, reward))


def top_option(distribution: Mapping[str, float]) -> str | None:
    """Return the most probable option, or None when several options share the top probability."""
    highest = max(distribution.values())
    leaders = [option for option, p in distribution.items() if p == highest]
    return leaders[0] if len(leaders) == 1 else None


def label_option(question: Question, label: Any) -> str:
    """Return the option name that a label selects."""
    if question.type == "noul":
        return "yes" if label else "no"
    return str(label)


def score_task(task: Task, answers: Any) -> list[QuestionResult]:
    """Score the answer to each labeled question of a task and ignore answers to other questions.

    An answer is an object with one key, probabilities. A missing or invalid answer earns 0.
    """
    submitted = answers if isinstance(answers, Mapping) else {}
    results = []
    for key, label in task.labels.items():
        question = task.questions[key]
        answer = submitted.get(key)
        distribution = None
        if isinstance(answer, Mapping) and list(answer) == ["probabilities"]:
            distribution = normalize(answer["probabilities"], question.options)
        if distribution is None:
            results.append(QuestionResult(key, question, label, None, 0.0, False))
            continue
        results.append(
            QuestionResult(
                key,
                question,
                label,
                distribution,
                question_reward(question, distribution, label),
                top_option(distribution) == label_option(question, label),
            )
        )
    return results


def episode_reward(results: Sequence[QuestionResult]) -> float:
    """Return the mean reward of a task's labeled questions."""
    return math.fsum(result.reward for result in results) / len(results)
