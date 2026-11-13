"""Serve a trained d1-omni-600M decision model from a managed online endpoint.

An Azure Machine Learning managed online endpoint, which hub-based Microsoft Foundry projects
also use, calls `init()` once when a server starts and `run()` for each request. `init()` loads
the released model and, when the registered model holds one, the readout or head that
`train_d1_omni.py train` saved. `run()` answers one page.

A request is shaped like a task in `tasks.jsonl`, with each image inlined as a data URI:

    {"state": {"rules": [...], "imagesNote": "..."},
     "images": ["data:image/png;base64,...", ...],
     "questions": {"mem_...": {"type": "noul", "instructions": "...", "criteria": {...}}}}

List the brand reference sheet first, then the page's screenshots, as training saw them.
`replica-learning decision ask` writes this request from a Build's screenshots. The response
answers each yes-or-no question in the action format, as `train_d1_omni.py predict` does:

    {"answers": {"mem_...": {"probabilities": {"yes": 0.93, "no": 0.07}}}}

The registered model is a folder that holds the released model in `d1-omni-600M/` and the
trained weights in `best.pt`. REPLICA_DECISION_BASE and REPLICA_DECISION_TRAINED name other
paths inside it. Without trained weights, the endpoint serves the released model.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import torch
from train_d1_omni import Policy

policy: Policy | None = None


def find(root: Path, name: str) -> Path | None:
    """Find a file or folder by its path in the model folder, which the platform may nest once."""
    for candidate in (root / name, *sorted(root.glob(f"*/{name}"))):
        if candidate.exists():
            return candidate
    return None


def init() -> None:
    global policy
    root = Path(os.environ.get("AZUREML_MODEL_DIR", "."))
    base = find(root, os.environ.get("REPLICA_DECISION_BASE", "d1-omni-600M"))
    if base is None:
        raise RuntimeError(f"No released model folder found in {root}.")
    weights = find(root, os.environ.get("REPLICA_DECISION_TRAINED", "best.pt"))
    trained = torch.load(weights, map_location="cpu") if weights else None
    policy = Policy(str(base), trained["part"] if trained else "head")
    if trained:
        policy.load(trained)


def run(raw_data: Any) -> dict[str, Any]:
    request = json.loads(raw_data) if isinstance(raw_data, (str, bytes)) else raw_data
    images, questions = request.get("images"), request.get("questions")
    if (
        not isinstance(images, list)
        or not images
        or not all(isinstance(image, str) and image.startswith("data:image/") for image in images)
    ):
        raise ValueError("images must be a non-empty list of image data URIs.")
    if not isinstance(questions, dict) or not any(
        isinstance(question, dict) and question.get("type") == "noul"
        for question in questions.values()
    ):
        raise ValueError("questions must include a yes-or-no question, the only kind answered.")
    try:
        features = policy.features("request", request.get("state"), images, questions)
        return {"answers": policy.answers(features)}
    finally:
        policy.cache.clear()
