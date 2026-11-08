"""OpenEnv binding. Each session wraps its own episode core around the shared taskset."""

from __future__ import annotations

import functools
import os
from typing import Any

from openenv.core.env_server.interfaces import Environment
from openenv.core.env_server.types import State

from ..episode import Episodes
from ..models import BrandCheckAction, BrandCheckObservation
from ..taskset import Taskset, load_taskset


@functools.lru_cache(maxsize=1)
def shared_taskset() -> Taskset:
    """Return the taskset in REPLICA_TASKSET_DIR, loaded and checked once per process."""
    return load_taskset(os.environ.get("REPLICA_TASKSET_DIR", "/data/taskset"))


class BrandCheckEnvironment(Environment[BrandCheckAction, BrandCheckObservation, State]):
    """Shows one task per episode and scores one set of probability answers.

    Errors from reset and step are raised as exceptions. Over the WebSocket, OpenEnv sends their
    messages to the client, which raises RuntimeError; the session stays open for the next reset.
    """

    # Sessions share only the read-only taskset; each one keeps its own episode.
    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self) -> None:
        super().__init__()
        self._episodes = Episodes(shared_taskset())

    def reset(
        self,
        seed: int | None = None,
        episode_id: str | None = None,
        split: str = "train",
        task_id: str | None = None,
        **kwargs: Any,
    ) -> BrandCheckObservation:
        """Start an episode with a task from the split, or the task named by task_id."""
        fields = self._episodes.reset(
            seed=seed, episode_id=episode_id, split=split, task_id=task_id, **kwargs
        )
        return BrandCheckObservation(**fields, done=False, reward=None)

    def step(
        self, action: BrandCheckAction, timeout_s: float | None = None, **kwargs: Any
    ) -> BrandCheckObservation:
        """Score the answers and end the episode."""
        outcome = self._episodes.step(action.answers)
        return BrandCheckObservation(
            task_id=outcome.task_id,
            split=outcome.split,
            done=True,
            reward=outcome.reward,
            metadata=outcome.metadata,
            **outcome.metadata,
        )

    @property
    def state(self) -> State:
        """Return the episode id and step count, plus the task id and split of the episode."""
        return State(**self._episodes.state())
