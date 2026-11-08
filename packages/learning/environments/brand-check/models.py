"""Action and observation models that OpenEnv sends over the wire."""

from typing import Any

from openenv.core.env_server.types import Action, Observation
from pydantic import Field


class BrandCheckAction(Action):
    """Probability answers to the questions of the current task."""

    answers: dict[str, Any] = Field(
        ...,
        description=(
            'Maps a question key to {"probabilities": {option: probability}}. A labeled question '
            "with a missing or invalid answer earns 0."
        ),
    )


class BrandCheckObservation(Observation):
    """A task after reset, or the per-question results after the step.

    OpenEnv 0.3.0 does not send observation metadata over the wire, so the step results are
    fields here as well as in metadata.
    """

    task_id: str = Field(..., description="Task id from tasks.jsonl.")
    split: str = Field(..., description="Split of the task: train, dev, or test.")
    state: dict[str, Any] = Field(
        default_factory=dict,
        description="Task state, such as the rules to check. Empty after the step.",
    )
    images: list[str] = Field(
        default_factory=list,
        description=(
            "Images as data URIs: an optional reference, then 1 to 4 screenshots of the page in "
            "the order state.imagesNote describes. Empty after the step."
        ),
    )
    questions: dict[str, Any] = Field(
        default_factory=dict, description="Questions by key. Empty after the step."
    )
    rewards: dict[str, float] = Field(
        default_factory=dict, description="After the step: the reward of each labeled question."
    )
    correct: dict[str, bool] = Field(
        default_factory=dict,
        description="After the step: whether the single most probable option matched each label.",
    )
    invalid: list[str] = Field(
        default_factory=list,
        description="After the step: labeled questions whose answer was missing or invalid.",
    )
    labels: dict[str, Any] = Field(
        default_factory=dict, description="After the step: the label of each labeled question."
    )
