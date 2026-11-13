"""Score a candidate's predictions on one split of a taskset and print a JSON report.

    python -m replica_brand_check.evaluate --taskset DIR --predictions FILE [--split dev]

Each predictions line is {"taskId": "...", "answers": {...}}, with answers in the action format.
Rewards come from the same code the environment uses.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .metrics import choice_report, mean, noul_report, score_report
from .scoring import QuestionResult, episode_reward, score_task
from .taskset import SPLITS, Taskset, TasksetError, load_taskset, quote

REPORT_SCHEMA = "replica.decision-evaluation/v1"


class EvaluationError(ValueError):
    """The predictions or the split cannot be scored. The message names the problem and the fix."""


def read_predictions(path: Path, taskset: Taskset) -> dict[str, Any]:
    """Return answers by task id. Malformed lines, unknown tasks, and repeated tasks are refused."""
    predictions: dict[str, Any] = {}
    first_lines: dict[str, int] = {}
    try:
        handle = path.open("rb")
    except OSError as error:
        raise EvaluationError(f"Cannot read {path}: {error.strerror}.") from None
    with handle:
        for number, line in enumerate(handle, start=1):
            where = f"{path.name} line {number}"
            try:
                record = json.loads(line.decode("utf-8"))
            except ValueError as error:
                raise EvaluationError(f"{where} is not valid JSON: {error}.") from None
            if not isinstance(record, dict) or sorted(record) != ["answers", "taskId"]:
                raise EvaluationError(f"{where} must be an object with only taskId and answers.")
            task_id = record["taskId"]
            if not isinstance(task_id, str) or task_id not in taskset.by_id:
                raise EvaluationError(
                    f"{where} names task {quote(task_id)}, which is not in the taskset. "
                    "Score predictions against the taskset they were made for."
                )
            if task_id in first_lines:
                raise EvaluationError(
                    f"{where} repeats task {task_id} from line {first_lines[task_id]}. "
                    "Keep one prediction per task."
                )
            if not isinstance(record["answers"], dict):
                raise EvaluationError(f"{where} answers must be an object.")
            first_lines[task_id] = number
            predictions[task_id] = record["answers"]
    return predictions


def evaluate(taskset: Taskset, predictions: Mapping[str, Any], split: str) -> dict[str, Any]:
    """Return the evaluation report for the labeled questions of one split.

    Metrics cover tasks that have a prediction. missingTasks counts the others.
    """
    tasks = taskset.by_split[split]
    if not tasks:
        raise EvaluationError(f"Split {split} has no tasks. Choose another split.")
    by_type: dict[str, list[QuestionResult]] = {"noul": [], "choice": [], "score": []}
    rewards = []
    for task in tasks:
        if task.id not in predictions:
            continue
        results = score_task(task, predictions[task.id])
        rewards.append(episode_reward(results))
        for result in results:
            by_type[result.question.type].append(result)
    return {
        "schemaVersion": REPORT_SCHEMA,
        "split": split,
        "tasks": len(tasks),
        "missingTasks": len(tasks) - len(rewards),
        "noul": noul_report(by_type["noul"]),
        "choice": choice_report(by_type["choice"]),
        "score": score_report(by_type["score"]),
        "meanReward": mean(rewards),
    }


def main(argv: Sequence[str] | None = None) -> int:
    """Print the report for the command line arguments and return the exit status."""
    parser = argparse.ArgumentParser(
        prog="python -m replica_brand_check.evaluate",
        description="Score predictions against the labels of one taskset split.",
    )
    parser.add_argument("--taskset", required=True, type=Path, help="taskset directory")
    parser.add_argument("--predictions", required=True, type=Path, help="predictions JSON Lines")
    parser.add_argument("--split", default="dev", choices=SPLITS, help="split to score")
    args = parser.parse_args(argv)
    try:
        taskset = load_taskset(args.taskset)
        report = evaluate(taskset, read_predictions(args.predictions, taskset), args.split)
    except (TasksetError, EvaluationError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
