"""Single-step episodes: reset shows a task without its labels, and step scores the answers."""

from __future__ import annotations

import base64
import copy
import random
import uuid
from dataclasses import dataclass
from typing import Any

from .scoring import episode_reward, score_task
from .taskset import SPLITS, Image, Task, Taskset, quote, read_image


class ResetError(ValueError):
    """The reset options are invalid or select no task."""


class EpisodeError(RuntimeError):
    """Step was called when no episode was open."""


@dataclass(frozen=True)
class StepOutcome:
    """The episode reward and the per-question results of one step."""

    task_id: str
    split: str
    reward: float
    metadata: dict[str, Any]


class Episodes:
    """One session's episodes over a shared, read-only taskset."""

    def __init__(self, taskset: Taskset) -> None:
        self._taskset = taskset
        self._random = random.Random()
        self._task: Task | None = None
        self._episode_id: str | None = None
        self._step_count = 0

    def reset(
        self,
        seed: int | None = None,
        episode_id: str | None = None,
        split: str = "train",
        task_id: str | None = None,
        **options: Any,
    ) -> dict[str, Any]:
        """Start an episode and return its observation fields, which never include labels.

        task_id selects one task from any split. Otherwise the task is drawn uniformly from the
        split, with random.Random(seed) when a seed is given, so the same seed draws the same task.
        """
        if options:
            names = ", ".join(quote(name) for name in sorted(options))
            raise ResetError(
                f"Unknown reset option {names}. Use seed, episode_id, split, or task_id."
            )
        if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int) or seed < 0):
            raise ResetError(f"seed {quote(seed)} must be a non-negative integer.")
        if episode_id is not None and not isinstance(episode_id, str):
            raise ResetError(f"episode_id {quote(episode_id)} must be a string.")
        if split not in SPLITS:
            raise ResetError(f"split {quote(split)} must be train, dev, or test.")
        task = self._select(seed, split, task_id)
        observation = {
            "task_id": task.id,
            "split": task.split,
            "state": copy.deepcopy(dict(task.state)),
            "images": [_data_uri(image) for image in task.images],
            "questions": {key: copy.deepcopy(dict(q.spec)) for key, q in task.questions.items()},
        }
        self._task = task
        self._episode_id = episode_id if episode_id is not None else str(uuid.uuid4())
        self._step_count = 0
        return observation

    def step(self, answers: Any) -> StepOutcome:
        """Score the answers for the open episode, then close the episode."""
        if self._task is None:
            raise EpisodeError("No episode is open: call reset before step.")
        if self._step_count:
            raise EpisodeError(
                "This episode is already done: each episode takes one step. "
                "Call reset to start the next episode."
            )
        results = score_task(self._task, answers)
        self._step_count = 1
        return StepOutcome(
            task_id=self._task.id,
            split=self._task.split,
            reward=episode_reward(results),
            metadata={
                "rewards": {result.key: result.reward for result in results},
                "correct": {result.key: result.correct for result in results},
                "invalid": [result.key for result in results if result.distribution is None],
                "labels": {result.key: result.label for result in results},
            },
        )

    def state(self) -> dict[str, Any]:
        """Return the episode id, step count, task id, and split.

        Before the first reset, the ids and the split are None.
        """
        return {
            "episode_id": self._episode_id,
            "step_count": self._step_count,
            "task_id": self._task.id if self._task else None,
            "split": self._task.split if self._task else None,
        }

    def _select(self, seed: int | None, split: str, task_id: Any) -> Task:
        if task_id is not None:
            task = self._taskset.by_id.get(task_id) if isinstance(task_id, str) else None
            if task is None:
                raise ResetError(f"Unknown task_id {quote(task_id)}. Use an id from tasks.jsonl.")
            return task
        tasks = self._taskset.by_split[split]
        if not tasks:
            raise ResetError(f"Split {split} has no tasks. Reset with another split.")
        chooser = random.Random(seed) if seed is not None else self._random
        return chooser.choice(tasks)


def _data_uri(image: Image) -> str:
    encoded = base64.b64encode(read_image(image)).decode("ascii")
    return f"data:{image.media_type};base64,{encoded}"
