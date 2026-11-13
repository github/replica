"""Load a decision taskset directory and refuse it unless every task, image, and label checks out.

Another component writes the taskset, so this module treats it as untrusted input. Loading
reads every line of tasks.jsonl and hashes every image once, so a server never starts with a
partially valid taskset. Image bytes stay on disk until an episode needs them.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any

TASKSET_SCHEMA = "replica.decision-taskset/v1"
TASK_SCHEMA = "replica.decision-task/v1"
SPLITS = ("train", "dev", "test")
MEDIA_TYPES = ("image/png", "image/jpeg", "image/webp")
SIZES = ("desktop", "narrow")
THEMES = ("light", "dark")
# The largest screenshot Hub keeps, which replica-learning decision taskset also accepts.
MAX_IMAGE_BYTES = 25 * 1024 * 1024

_TASK_ID = re.compile(r"task_[0-9a-f]{24}")
_KEY = re.compile(r"[A-Za-z0-9_]{1,64}")
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
_TASK_FIELDS = (
    "schemaVersion",
    "id",
    "split",
    "state",
    "images",
    "questions",
    "labels",
    "provenance",
)
_IMAGE_FIELDS = ("role", "path", "mediaType", "digest")
_RENDERING_FIELDS = ("size", "theme")
# A Build has at most one screenshot of a page for each size and theme.
_MAX_CANDIDATES = len(SIZES) * len(THEMES)
# A task's images: the brand reference, when the taskset has one, and its candidates.
MAX_IMAGES = 1 + _MAX_CANDIDATES


class TasksetError(ValueError):
    """The taskset cannot be used. The message names the file, the line, and the fix."""


class _Problem(Exception):
    """One reason a task line is invalid. The loader adds the line number."""


@dataclass(frozen=True)
class Question:
    """A typed question and the option names that a probability distribution uses for it."""

    key: str
    type: str
    options: tuple[str, ...]
    spec: Mapping[str, Any]


@dataclass(frozen=True)
class Image:
    """An image that passed the path, byte size, and digest checks.

    size and theme tell how the page in a candidate was rendered. A reference image has neither.
    """

    role: str
    name: str
    path: Path
    media_type: str
    digest: str
    size: str | None
    theme: str | None


@dataclass(frozen=True)
class Task:
    """One checked task. Its labels and provenance never appear in a reset observation."""

    id: str
    split: str
    state: Mapping[str, Any]
    images: tuple[Image, ...]
    questions: Mapping[str, Question]
    labels: Mapping[str, Any]
    provenance: Mapping[str, Any]


@dataclass(frozen=True)
class Taskset:
    """Every task of a taskset directory, indexed by id and by split."""

    directory: Path
    metadata: Mapping[str, Any]
    tasks: tuple[Task, ...]
    by_id: Mapping[str, Task]
    by_split: Mapping[str, tuple[Task, ...]]


def quote(value: Any) -> str:
    """Return untrusted input as a short JSON literal that is safe to put in an error message."""
    text = json.dumps(value, ensure_ascii=True)
    return text if len(text) <= 80 else text[:77] + "..."


def question_options(question: Mapping[str, Any]) -> tuple[str, ...]:
    """Return the option names, in order, that a distribution for this question uses."""
    if question["type"] == "noul":
        return ("yes", "no")
    if question["type"] == "choice":
        return tuple(question["criteria"])
    return tuple(str(level) for level in range(len(question["criteria"])))


def load_taskset(directory: str | os.PathLike[str]) -> Taskset:
    """Return the checked taskset in a directory, or raise TasksetError naming the first problem."""
    root = Path(os.path.realpath(directory))
    if not root.is_dir():
        raise TasksetError(
            f"{directory} is not a directory. Point REPLICA_TASKSET_DIR or --taskset at a "
            "taskset directory created by replica-learning decision taskset."
        )
    metadata = _read_manifest(root)
    tasks = _read_tasks(root)
    by_split = {split: tuple(task for task in tasks if task.split == split) for split in SPLITS}
    return Taskset(
        directory=root,
        metadata=metadata,
        tasks=tasks,
        by_id=MappingProxyType({task.id: task for task in tasks}),
        by_split=MappingProxyType(by_split),
    )


def read_image(image: Image) -> bytes:
    """Return the image bytes after checking that they still match the digest the task names."""
    try:
        with image.path.open("rb") as handle:
            data = handle.read(MAX_IMAGE_BYTES + 1)
    except OSError as error:
        raise TasksetError(
            f"Image {quote(image.name)} cannot be read: {error.strerror}. "
            "Restore the taskset and restart the server."
        ) from None
    if "sha256:" + hashlib.sha256(data).hexdigest() != image.digest:
        raise TasksetError(
            f"Image {quote(image.name)} changed after the taskset was loaded. "
            "Restore the taskset and restart the server."
        )
    return data


def _parse_json(text: str) -> Any:
    """Parse strict JSON, refusing repeated member names, NaN, and Infinity instead of guessing."""
    try:
        return json.loads(text, object_pairs_hook=_unique_members, parse_constant=_refuse_constant)
    except json.JSONDecodeError as error:
        raise ValueError(f"{error.msg} at character {error.pos + 1}") from None


def _unique_members(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    members: dict[str, Any] = {}
    for name, value in pairs:
        if name in members:
            raise ValueError(f"member {quote(name)} repeats")
        members[name] = value
    return members


def _refuse_constant(name: str) -> Any:
    raise ValueError(f"{name} is not a JSON number")


def _read_manifest(root: Path) -> Mapping[str, Any]:
    try:
        manifest = _parse_json((root / "taskset.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise TasksetError(
            f"{root} has no taskset.json. "
            "Use a directory created by replica-learning decision taskset."
        ) from None
    except OSError as error:
        raise TasksetError(
            f"taskset.json cannot be read: {error.strerror}. Check the file permissions."
        ) from None
    except ValueError as error:
        raise TasksetError(f"taskset.json is not valid JSON: {error}.") from None
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != TASKSET_SCHEMA:
        raise TasksetError(
            f"taskset.json must be an object with schemaVersion {TASKSET_SCHEMA}. "
            "Recreate the taskset with replica-learning decision taskset."
        )
    return MappingProxyType(manifest)


def _read_tasks(root: Path) -> tuple[Task, ...]:
    tasks: list[Task] = []
    first_lines: dict[str, int] = {}
    digests: dict[Path, str] = {}
    try:
        handle = (root / "tasks.jsonl").open("rb")
    except FileNotFoundError:
        raise TasksetError(
            f"{root} has no tasks.jsonl. "
            "Use a directory created by replica-learning decision taskset."
        ) from None
    except OSError as error:
        raise TasksetError(
            f"tasks.jsonl cannot be read: {error.strerror}. Check the file permissions."
        ) from None
    with handle:
        for number, line in enumerate(handle, start=1):
            try:
                task = _check_task(line, root, digests)
            except _Problem as problem:
                raise TasksetError(f"tasks.jsonl line {number}: {problem}.") from None
            if task.id in first_lines:
                raise TasksetError(
                    f"tasks.jsonl line {number}: task id {task.id} repeats line "
                    f"{first_lines[task.id]}. Give every task its own id."
                )
            first_lines[task.id] = number
            tasks.append(task)
    if not tasks:
        raise TasksetError(
            "tasks.jsonl has no tasks. Recreate the taskset with replica-learning decision taskset."
        )
    return tuple(tasks)


def _check_task(line: bytes, root: Path, digests: dict[Path, str]) -> Task:
    try:
        data = _parse_json(line.decode("utf-8"))
    except UnicodeDecodeError:
        raise _Problem("the line is not UTF-8 text") from None
    except ValueError as error:
        raise _Problem(f"the line is not valid JSON: {error}") from None
    if not isinstance(data, dict):
        raise _Problem("the line must hold a JSON object")
    _check_fields(data, _TASK_FIELDS, "the task")
    if data["schemaVersion"] != TASK_SCHEMA:
        raise _Problem(
            f"schemaVersion is {quote(data['schemaVersion'])}, "
            f"but this environment reads {TASK_SCHEMA}"
        )
    task_id = data["id"]
    if not isinstance(task_id, str) or not _TASK_ID.fullmatch(task_id):
        raise _Problem(f"id {quote(task_id)} must be task_ followed by 24 lowercase hex digits")
    if data["split"] not in SPLITS:
        raise _Problem(f"split {quote(data['split'])} must be train, dev, or test")
    for field in ("state", "provenance"):
        if not isinstance(data[field], dict):
            raise _Problem(f"{field} must be an object")
    images = _check_images(data["images"], root, digests)
    questions = _check_questions(data["questions"])
    return Task(
        id=task_id,
        split=data["split"],
        state=data["state"],
        images=images,
        questions=questions,
        labels=_check_labels(data["labels"], questions),
        provenance=data["provenance"],
    )


def _check_fields(
    data: dict[str, Any], required: tuple[str, ...], what: str, optional: tuple[str, ...] = ()
) -> None:
    missing = [field for field in required if field not in data]
    if missing:
        raise _Problem(f"{what} is missing {', '.join(missing)}")
    unknown = [field for field in data if field not in required + optional]
    if unknown:
        raise _Problem(f"{what} has field {quote(unknown[0])}, which version 1 does not define")


def _check_images(value: Any, root: Path, digests: dict[Path, str]) -> tuple[Image, ...]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_IMAGES:
        raise _Problem(
            "images must list 1 to 5 images: an optional reference, then 1 to 4 candidates"
        )
    images = tuple(_check_image(item, root, digests) for item in value)
    candidates = images[1:] if images[0].role == "reference" else images
    if any(image.role != "candidate" for image in candidates):
        raise _Problem("the reference image must come first, and a task may have only one")
    if not 1 <= len(candidates) <= _MAX_CANDIDATES:
        raise _Problem(f"images must list 1 to 4 candidates, not {len(candidates)}")
    renderings: set[tuple[str | None, str | None]] = set()
    for image in candidates:
        if (image.size, image.theme) in renderings:
            raise _Problem(
                f"images list two {image.size} {image.theme} candidates; "
                "keep one image for each size and theme"
            )
        renderings.add((image.size, image.theme))
    return images


def _check_image(item: Any, root: Path, digests: dict[Path, str]) -> Image:
    if not isinstance(item, dict):
        raise _Problem("each image must be an object")
    _check_fields(item, _IMAGE_FIELDS, "an image", optional=_RENDERING_FIELDS)
    role, name, media_type, digest = item["role"], item["path"], item["mediaType"], item["digest"]
    if role not in ("reference", "candidate"):
        raise _Problem(f"image role {quote(role)} must be reference or candidate")
    if role == "reference" and any(field in item for field in _RENDERING_FIELDS):
        raise _Problem("a reference image must not have size or theme; only candidates have them")
    if role == "candidate":
        _check_fields(item, _IMAGE_FIELDS + _RENDERING_FIELDS, "a candidate image")
        if item["size"] not in SIZES:
            raise _Problem(f"candidate size {quote(item['size'])} must be desktop or narrow")
        if item["theme"] not in THEMES:
            raise _Problem(f"candidate theme {quote(item['theme'])} must be light or dark")
    if media_type not in MEDIA_TYPES:
        raise _Problem(
            f"image mediaType {quote(media_type)} must be image/png, image/jpeg, or image/webp"
        )
    if not isinstance(digest, str) or not _DIGEST.fullmatch(digest):
        raise _Problem(
            f"image digest {quote(digest)} must be sha256: followed by 64 lowercase hex digits"
        )
    path = _resolve_image(name, root)
    # Tasks often share a reference image, so each file is hashed once per load.
    if path not in digests:
        digests[path] = _hash_image(path, name)
    if digests[path] != digest:
        raise _Problem(
            f"image {quote(name)} has digest {digests[path]}, but the task names {digest}; "
            "recreate the taskset"
        )
    return Image(
        role=role,
        name=name,
        path=path,
        media_type=media_type,
        digest=digest,
        size=item.get("size"),
        theme=item.get("theme"),
    )


def _resolve_image(name: Any, root: Path) -> Path:
    if not isinstance(name, str) or not name:
        raise _Problem("image path must be a non-empty string")
    if "\\" in name:
        raise _Problem(f"image path {quote(name)} must use forward slashes")
    if "\x00" in name:
        raise _Problem(f"image path {quote(name)} contains a NUL character")
    if name.startswith("/"):
        raise _Problem(
            f"image path {quote(name)} is absolute; use a path relative to the taskset directory"
        )
    if ".." in name.split("/"):
        raise _Problem(f"image path {quote(name)} has a .. segment; use a path inside the taskset")
    try:
        path = Path(os.path.realpath(root / name, strict=True))
    except FileNotFoundError:
        raise _Problem(f"image {quote(name)} does not exist") from None
    except OSError as error:
        raise _Problem(f"image {quote(name)} cannot be read: {error.strerror}") from None
    if not path.is_relative_to(root):
        raise _Problem(f"image path {quote(name)} leaves the taskset directory")
    return path


def _hash_image(path: Path, name: str) -> str:
    try:
        info = path.stat()
        if not stat.S_ISREG(info.st_mode):
            raise _Problem(f"image {quote(name)} is not a regular file")
        if info.st_size > MAX_IMAGE_BYTES:
            raise _Problem(f"image {quote(name)} is {info.st_size} bytes, over the 25 MiB limit")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    except OSError as error:
        raise _Problem(f"image {quote(name)} cannot be read: {error.strerror}") from None
    return "sha256:" + digest.hexdigest()


def _check_questions(value: Any) -> Mapping[str, Question]:
    if not isinstance(value, dict) or not value:
        raise _Problem("questions must be a non-empty object")
    questions = {}
    for key, spec in value.items():
        if not _KEY.fullmatch(key):
            raise _Problem(
                f"question key {quote(key)} must be 1 to 64 letters, digits, or underscores"
            )
        questions[key] = _check_question(key, spec)
    return MappingProxyType(questions)


def _check_question(key: str, spec: Any) -> Question:
    if not isinstance(spec, dict):
        raise _Problem(f"question {key} must be an object")
    _check_fields(spec, ("type", "instructions"), f"question {key}", optional=("criteria",))
    kind, criteria = spec["type"], spec.get("criteria")
    if kind not in ("noul", "choice", "score"):
        raise _Problem(f"question {key} type {quote(kind)} must be noul, choice, or score")
    if not isinstance(spec["instructions"], str) or not spec["instructions"].strip():
        raise _Problem(f"question {key} needs instructions text")
    if (
        kind == "noul"
        and "criteria" in spec
        and not (
            isinstance(criteria, dict)
            and set(criteria) <= {"true", "false"}
            and all(isinstance(text, str) for text in criteria.values())
        )
    ):
        raise _Problem(f"question {key} criteria may only describe true and false")
    if kind == "choice":
        if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 255:
            raise _Problem(f"question {key} criteria must name 2 to 255 options")
        for option, text in criteria.items():
            if not _KEY.fullmatch(option) or not isinstance(text, str):
                raise _Problem(
                    f"question {key} option {quote(option)} must be 1 to 64 letters, digits, "
                    "or underscores, described by text"
                )
    if kind == "score" and not (
        isinstance(criteria, list)
        and 2 <= len(criteria) <= 10
        and all(isinstance(level, str) for level in criteria)
    ):
        raise _Problem(
            f"question {key} criteria must list 2 to 10 level descriptions, lowest first"
        )
    return Question(key=key, type=kind, options=question_options(spec), spec=MappingProxyType(spec))


def _check_labels(value: Any, questions: Mapping[str, Question]) -> Mapping[str, Any]:
    if not isinstance(value, dict) or not value:
        raise _Problem("labels must be a non-empty object")
    labels = {}
    for key, label in value.items():
        question = questions.get(key)
        if question is None:
            raise _Problem(
                f"label {quote(key)} names no question; every label key must be a question key"
            )
        if not isinstance(label, dict) or list(label) != ["answer"]:
            raise _Problem(f"label {key} must be an object with only an answer")
        answer = label["answer"]
        if question.type == "noul" and not isinstance(answer, bool):
            raise _Problem(f"label {key} answer {quote(answer)} must be true or false")
        if question.type == "choice" and answer not in question.options:
            raise _Problem(
                f"label {key} answer {quote(answer)} must be one of the question's options"
            )
        if question.type == "score" and (
            isinstance(answer, bool)
            or not isinstance(answer, int)
            or not 0 <= answer < len(question.options)
        ):
            raise _Problem(
                f"label {key} answer {quote(answer)} must be a level from 0 to "
                f"{len(question.options) - 1}"
            )
        labels[key] = answer
    return MappingProxyType(labels)
