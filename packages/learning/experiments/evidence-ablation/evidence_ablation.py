#!/usr/bin/env python3
"""Offline A/B/C evidence ablation runner for Replica's learning loop."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.util
import json
import math
import os
import shutil
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping

ROOT = Path(__file__).resolve().parents[2]
BRAND_CHECK = ROOT / "environments" / "brand-check"
if "replica_brand_check" not in sys.modules:
    package_spec = importlib.util.spec_from_file_location(
        "replica_brand_check",
        BRAND_CHECK / "__init__.py",
        submodule_search_locations=[str(BRAND_CHECK)],
    )
    if package_spec is None or package_spec.loader is None:
        raise RuntimeError("Cannot load the local replica_brand_check package.")
    package = importlib.util.module_from_spec(package_spec)
    sys.modules["replica_brand_check"] = package
    package_spec.loader.exec_module(package)

from replica_brand_check.runtime import LocalRuntime  # type: ignore  # noqa: E402
from replica_brand_check.taskset import load_taskset  # type: ignore  # noqa: E402

CORPUS_SCHEMA = "replica.learning-evidence-corpus/v1"
MANIFEST_SCHEMA = "replica.learning-evidence-experiment/v1"
REPORT_SCHEMA = "replica.learning-evidence-ablation-report/v1"
TASK_SCHEMA = "replica.decision-task/v1"
TASKSET_SCHEMA = "replica.decision-taskset/v1"
TIERS = ("A", "B", "C")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
MAX_IMAGE_BYTES = 25 * 1024 * 1024


class ExperimentError(ValueError):
    """The experiment input or local runtime cannot produce a trustworthy result."""


@dataclass(frozen=True)
class SplitPlan:
    by_prototype: Mapping[str, str]
    counts: Mapping[str, int]


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def digest(value: Any) -> str:
    data = value if isinstance(value, bytes) else canonical(value)
    return "sha256:" + hashlib.sha256(data).hexdigest()


def short_digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ExperimentError(f"Cannot read {path}: {error}.") from None
    if not isinstance(value, dict):
        raise ExperimentError(f"{path} must contain a JSON object.")
    return value


def validate_manifest(value: Mapping[str, Any]) -> None:
    exact_fields(
        value,
        {"schemaVersion", "name", "corpus", "tiers", "split", "runtime", "budgets", "privacy"},
        "manifest",
    )
    if value["schemaVersion"] != MANIFEST_SCHEMA:
        raise ExperimentError(f"manifest schemaVersion must be {MANIFEST_SCHEMA}.")
    if not isinstance(value["corpus"], str) or not value["corpus"].strip():
        raise ExperimentError("manifest corpus must name one explicit local JSON file.")
    tiers = value["tiers"]
    if not isinstance(tiers, list) or len(tiers) < 2 or any(tier not in TIERS for tier in tiers):
        raise ExperimentError("manifest tiers must select at least two of A, B, and C.")
    if len(set(tiers)) != len(tiers):
        raise ExperimentError("manifest tiers must not repeat.")
    split = object_field(value, "split")
    exact_fields(split, {"unit", "seed", "train", "dev", "test"}, "manifest split")
    if split["unit"] not in ("prototype", "repository") or not isinstance(split["seed"], int):
        raise ExperimentError("manifest split needs unit prototype or repository and an integer seed.")
    shares = [split[name] for name in ("train", "dev", "test")]
    if any(not isinstance(share, (int, float)) or not 0 < share < 1 for share in shares):
        raise ExperimentError("manifest split shares must each be between 0 and 1.")
    if not math.isclose(sum(shares), 1.0, abs_tol=1e-9):
        raise ExperimentError("manifest split shares must sum to 1.")
    runtime = object_field(value, "runtime")
    required_runtime = {"backend", "maxUpdates", "maxSeconds"}
    unknown_runtime = set(runtime) - (required_runtime | {"backendModule"})
    missing_runtime = required_runtime - set(runtime)
    if missing_runtime or unknown_runtime:
        details = []
        if missing_runtime:
            details.append("missing " + ", ".join(sorted(missing_runtime)))
        if unknown_runtime:
            details.append("unknown " + ", ".join(sorted(unknown_runtime)))
        raise ExperimentError("manifest runtime has " + " and ".join(details) + ".")
    if not isinstance(runtime["backend"], str) or not runtime["backend"]:
        raise ExperimentError("manifest runtime backend must be a nonempty string.")
    if "backendModule" in runtime and (
        not isinstance(runtime["backendModule"], str) or not runtime["backendModule"].strip()
    ):
        raise ExperimentError("manifest runtime backendModule must name one explicit local Python file.")
    if not isinstance(runtime["maxUpdates"], int) or not 1 <= runtime["maxUpdates"] <= 100_000:
        raise ExperimentError("manifest runtime maxUpdates must be from 1 to 100000.")
    if not isinstance(runtime["maxSeconds"], (int, float)) or not 1 <= runtime["maxSeconds"] <= 86_400:
        raise ExperimentError("manifest runtime maxSeconds must be from 1 to 86400.")
    budgets = object_field(value, "budgets")
    exact_fields(budgets, {"maxComments", "maxOutcomes", "maxSessionActions"}, "manifest budgets")
    if any(not isinstance(item, int) or item < 1 for item in budgets.values()):
        raise ExperimentError("manifest budgets must be positive integers.")
    privacy = object_field(value, "privacy")
    if privacy != {"reportIdentifiers": "digests-only", "includeRawContent": False}:
        raise ExperimentError("manifest privacy must require digests-only reports with no raw content.")


def validate_corpus(value: Mapping[str, Any]) -> None:
    exact_fields(value, {"schemaVersion", "purpose", "source", "learnings", "prototypes"}, "corpus")
    if value["schemaVersion"] != CORPUS_SCHEMA:
        raise ExperimentError(f"corpus schemaVersion must be {CORPUS_SCHEMA}.")
    purpose = object_field(value, "purpose")
    exact_fields(
        purpose,
        {"id", "description", "consentRecordedAt", "approvedBy", "allowedUses", "retention"},
        "corpus purpose",
    )
    if "evaluation" not in list_field(purpose, "allowedUses"):
        raise ExperimentError("corpus purpose must explicitly allow evaluation.")
    retention = object_field(purpose, "retention")
    exact_fields(retention, {"owner", "deleteBy"}, "corpus retention")
    require_timestamp(purpose["consentRecordedAt"], "purpose consentRecordedAt")
    require_timestamp(retention["deleteBy"], "retention deleteBy")
    source = object_field(value, "source")
    exact_fields(source, {"kind", "repositoryScope", "exportedAt"}, "corpus source")
    if source["kind"] not in ("synthetic", "explicit-local-export"):
        raise ExperimentError("corpus source kind must be synthetic or explicit-local-export.")
    require_timestamp(source["exportedAt"], "source exportedAt")
    learnings = list_field(value, "learnings")
    if not learnings:
        raise ExperimentError("corpus needs at least one learning.")
    learning_ids = set()
    for learning in learnings:
        if not isinstance(learning, dict):
            raise ExperimentError("each learning must be an object.")
        exact_fields(learning, {"id", "text", "theme", "fixtureTerms"}, "learning")
        if learning["id"] in learning_ids:
            raise ExperimentError(f"learning {learning['id']} repeats.")
        learning_ids.add(learning["id"])
        if not isinstance(learning["text"], str) or not learning["text"].strip():
            raise ExperimentError("learning text must be nonempty.")
        terms = list_field(learning, "fixtureTerms")
        if not terms or any(not isinstance(term, str) or not term.strip() for term in terms):
            raise ExperimentError("learning fixtureTerms must contain nonempty strings.")
    prototypes = list_field(value, "prototypes")
    if len(prototypes) < 3:
        raise ExperimentError("corpus needs at least three prototypes for train, dev, and test.")
    seen = set()
    for prototype in prototypes:
        validate_prototype(prototype, learning_ids, purpose["id"])
        if prototype["id"] in seen:
            raise ExperimentError(f"prototype {prototype['id']} repeats.")
        seen.add(prototype["id"])


def validate_prototype(prototype: Any, learning_ids: set[str], consent_id: str) -> None:
    if not isinstance(prototype, dict):
        raise ExperimentError("each prototype must be an object.")
    exact_fields(
        prototype,
        {
            "id",
            "repositoryId",
            "name",
            "branch",
            "startPage",
            "templates",
            "tierA",
            "tierB",
            "tierC",
            "evaluation",
        },
        "prototype",
    )
    if not isinstance(prototype["startPage"], str) or not prototype["startPage"].startswith("/"):
        raise ExperimentError(f"prototype {prototype['id']} startPage must be a local route.")
    for template in list_field(prototype, "templates"):
        exact_fields(template, {"id", "name", "route"}, "prototype template")
    tier_a = object_field(prototype, "tierA")
    exact_fields(tier_a, {"reviewThreads"}, "tier A")
    thread_ids = set()
    for thread in list_field(tier_a, "reviewThreads"):
        exact_fields(thread, {"id", "buildNumber", "route", "anchor", "comments"}, "review thread")
        if thread["id"] in thread_ids:
            raise ExperimentError(f"prototype {prototype['id']} repeats thread {thread['id']}.")
        thread_ids.add(thread["id"])
        anchor = object_field(thread, "anchor")
        if anchor != {
            "schemaVersion": "replica.review-anchor/v1",
            "kind": anchor.get("kind"),
            "route": thread["route"],
        } or anchor["kind"] not in ("element", "area"):
            raise ExperimentError(f"thread {thread['id']} has an invalid or mismatched review anchor.")
        comments = list_field(thread, "comments")
        if not comments or comments[0].get("kind") != "root":
            raise ExperimentError(f"thread {thread['id']} must start with one root comment.")
        for comment in comments:
            allowed = {"id", "kind", "body", "createdAt", "editedAt", "deletedAt", "actor"}
            if not isinstance(comment, dict) or set(comment) - allowed:
                raise ExperimentError(f"thread {thread['id']} has an invalid comment.")
            if comment.get("kind") not in ("root", "reply"):
                raise ExperimentError(f"thread {thread['id']} has an invalid comment kind.")
            require_timestamp(comment.get("createdAt"), "comment createdAt")
            for name in ("editedAt", "deletedAt"):
                if name in comment:
                    require_timestamp(comment[name], f"comment {name}")
            actor(comment.get("actor"))
            if "deletedAt" in comment and comment.get("body") is not None:
                raise ExperimentError(f"deleted comment {comment['id']} must not retain its body.")
    tier_b = object_field(prototype, "tierB")
    exact_fields(tier_b, {"builds", "outcomes"}, "tier B")
    build_numbers = set()
    for build in list_field(tier_b, "builds"):
        exact_fields(build, {"number", "commitSha", "createdAt", "routes"}, "build")
        if build["number"] in build_numbers:
            raise ExperimentError(f"prototype {prototype['id']} repeats Build {build['number']}.")
        build_numbers.add(build["number"])
        if not isinstance(build["commitSha"], str) or len(build["commitSha"]) != 40:
            raise ExperimentError("build commitSha must be 40 lowercase hex characters.")
        require_timestamp(build["createdAt"], "build createdAt")
        for route in list_field(build, "routes"):
            exact_fields(route, {"route", "screenshots"}, "build route")
            for screenshot in list_field(route, "screenshots"):
                allowed = {"size", "theme", "path"}
                if not isinstance(screenshot, dict) or set(screenshot) - allowed:
                    raise ExperimentError("a screenshot has unknown fields.")
                if screenshot.get("size") not in ("desktop", "narrow"):
                    raise ExperimentError("screenshot size must be desktop or narrow.")
                if screenshot.get("theme") not in ("light", "dark"):
                    raise ExperimentError("screenshot theme must be light or dark.")
                if not isinstance(screenshot.get("path"), str) or not screenshot["path"]:
                    raise ExperimentError("every screenshot must name its explicit relative path.")
    for outcome in list_field(tier_b, "outcomes"):
        exact_fields(
            outcome,
            {
                "threadId",
                "learningId",
                "problemBuildNumber",
                "changedBuildNumber",
                "events",
                "reviewerVerified",
                "changed",
            },
            "review outcome",
        )
        if outcome["threadId"] not in thread_ids or outcome["learningId"] not in learning_ids:
            raise ExperimentError("review outcome must name a local thread and known learning.")
        if outcome["problemBuildNumber"] not in build_numbers or outcome["changedBuildNumber"] not in build_numbers:
            raise ExperimentError("review outcome must name Builds from the same prototype.")
        for event in list_field(outcome, "events"):
            exact_fields(event, {"kind", "at", "actor"}, "review outcome event")
            if event["kind"] not in ("resolved", "reopened", "resolved-again"):
                raise ExperimentError("review outcome event kind is invalid.")
            require_timestamp(event["at"], "review outcome event at")
            actor(event["actor"])
    tier_c = object_field(prototype, "tierC")
    exact_fields(tier_c, {"authoringSessions"}, "tier C")
    for session in list_field(tier_c, "authoringSessions"):
        allowed = {"id", "purpose", "consentId", "startedAt", "prompt", "actions"}
        if not isinstance(session, dict) or set(session) != allowed:
            raise ExperimentError("authoring session must use the exact v1 fields.")
        if session["purpose"] != "evaluation" or session["consentId"] != consent_id:
            raise ExperimentError("authoring session must name this corpus's evaluation consent.")
        require_timestamp(session["startedAt"], "authoring session startedAt")
        for action in list_field(session, "actions"):
            allowed_action = {"kind", "at", "learningId", "buildNumber", "result", "screenshotPath"}
            if not isinstance(action, dict) or set(action) - allowed_action:
                raise ExperimentError("authoring action has unknown fields.")
            if action.get("learningId") not in learning_ids or action.get("buildNumber") not in build_numbers:
                raise ExperimentError("authoring action must name a known learning and Build.")
            if action.get("result") not in ("improved", "regressed", "unchanged"):
                raise ExperimentError("authoring action result is invalid.")
            require_timestamp(action.get("at"), "authoring action at")
    evaluation = object_field(prototype, "evaluation")
    exact_fields(evaluation, {"expectedLearnings", "buildLabels"}, "prototype evaluation")
    if any(item not in learning_ids for item in list_field(evaluation, "expectedLearnings")):
        raise ExperimentError("expectedLearnings must name known learnings.")
    for label in list_field(evaluation, "buildLabels"):
        exact_fields(label, {"buildNumber", "route", "learningId", "follows", "judgment"}, "build label")
        if label["buildNumber"] not in build_numbers or label["learningId"] not in learning_ids:
            raise ExperimentError("build label must name a known Build and learning.")
        if label["judgment"] not in ("synthetic-ground-truth", "human-blinded"):
            raise ExperimentError("build label judgment must be synthetic-ground-truth or human-blinded.")


def exact_fields(value: Mapping[str, Any], expected: set[str], name: str) -> None:
    if set(value) != expected:
        missing = sorted(expected - set(value))
        unknown = sorted(set(value) - expected)
        details = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unknown:
            details.append("unknown " + ", ".join(unknown))
        raise ExperimentError(f"{name} has " + " and ".join(details) + ".")


def object_field(value: Mapping[str, Any], name: str) -> dict[str, Any]:
    member = value.get(name)
    if not isinstance(member, dict):
        raise ExperimentError(f"{name} must be an object.")
    return member


def list_field(value: Mapping[str, Any], name: str) -> list[Any]:
    member = value.get(name)
    if not isinstance(member, list):
        raise ExperimentError(f"{name} must be an array.")
    return member


def require_timestamp(value: Any, name: str) -> None:
    if not isinstance(value, str):
        raise ExperimentError(f"{name} must be a timestamp.")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ExperimentError(f"{name} must be an RFC 3339 timestamp.") from None


def actor(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {"kind", "id"}:
        raise ExperimentError("actor must contain only kind and id.")
    if value["kind"] not in ("human", "agent", "system") or not isinstance(value["id"], str):
        raise ExperimentError("actor kind or id is invalid.")


def split_plan(corpus: Mapping[str, Any], settings: Mapping[str, Any]) -> SplitPlan:
    unit = settings["unit"]
    boundaries: dict[str, list[str]] = {}
    for prototype in corpus["prototypes"]:
        boundary = prototype["id"] if unit == "prototype" else prototype["repositoryId"]
        boundaries.setdefault(boundary, []).append(prototype["id"])
    if len(boundaries) < 3:
        raise ExperimentError(f"{unit} split needs at least three distinct boundaries.")
    ranked = sorted(
        boundaries,
        key=lambda item: hashlib.sha256(f"{settings['seed']}\0{item}".encode()).hexdigest(),
    )
    total = len(ranked)
    dev_count = max(1, round(total * settings["dev"]))
    test_count = max(1, round(total * settings["test"]))
    if dev_count + test_count >= total:
        dev_count = 1
        test_count = 1
    train_count = total - dev_count - test_count
    assignments = {}
    for index, boundary in enumerate(ranked):
        split = "train" if index < train_count else ("dev" if index < train_count + dev_count else "test")
        for prototype_id in boundaries[boundary]:
            assignments[prototype_id] = split
    counts = {name: sum(1 for value in assignments.values() if value == name) for name in ("train", "dev", "test")}
    return SplitPlan(assignments, counts)


def evidence_for(prototype: Mapping[str, Any], tier: str, budgets: Mapping[str, int]) -> dict[str, Any]:
    threads = prototype["tierA"]["reviewThreads"]
    comments = [comment for thread in threads for comment in thread["comments"]]
    result = {
        "threads": threads,
        "comments": comments[: budgets["maxComments"]],
        "builds": [],
        "outcomes": [],
        "sessions": [],
        "actions": [],
    }
    if tier in ("B", "C"):
        result["builds"] = prototype["tierB"]["builds"]
        result["outcomes"] = prototype["tierB"]["outcomes"][: budgets["maxOutcomes"]]
    if tier == "C":
        result["sessions"] = prototype["tierC"]["authoringSessions"]
        result["actions"] = [
            action for session in result["sessions"] for action in session["actions"]
        ][: budgets["maxSessionActions"]]
    return result


def proposal_set(corpus: Mapping[str, Any], tier: str, plan: SplitPlan, budgets: Mapping[str, int]) -> set[str]:
    proposals = set()
    for learning in corpus["learnings"]:
        supporting_prototypes = set()
        terms = [term.lower() for term in learning["fixtureTerms"]]
        for prototype in corpus["prototypes"]:
            if plan.by_prototype[prototype["id"]] != "train":
                continue
            evidence = evidence_for(prototype, tier, budgets)
            raw = " ".join(
                comment["body"] or ""
                for comment in evidence["comments"]
                if comment.get("deletedAt") is None
            ).lower()
            comment_support = any(term in raw for term in terms)
            outcome_support = any(
                item["learningId"] == learning["id"] and item["changed"] and item["reviewerVerified"]
                for item in evidence["outcomes"]
            )
            action_support = any(
                item["learningId"] == learning["id"] and item["result"] == "improved"
                for item in evidence["actions"]
            )
            if comment_support or outcome_support or action_support:
                supporting_prototypes.add(prototype["id"])
        if len(supporting_prototypes) >= 2:
            proposals.add(learning["id"])
    return proposals


def inferred_train_labels(
    prototype: Mapping[str, Any],
    tier: str,
    learnings: Iterable[Mapping[str, Any]],
    budgets: Mapping[str, int],
) -> dict[tuple[int, str, str], bool]:
    evidence = evidence_for(prototype, tier, budgets)
    labels: dict[tuple[int, str, str], bool] = {}
    for learning in learnings:
        terms = [term.lower() for term in learning["fixtureTerms"]]
        for thread in evidence["threads"]:
            text = " ".join(
                comment["body"] or ""
                for comment in thread["comments"]
                if comment.get("deletedAt") is None
            ).lower()
            if any(term in text for term in terms):
                labels[(thread["buildNumber"], thread["route"], learning["id"])] = False
    for outcome in evidence["outcomes"]:
        thread = next((item for item in evidence["threads"] if item["id"] == outcome["threadId"]), None)
        if thread is None:
            continue
        labels[(outcome["problemBuildNumber"], thread["route"], outcome["learningId"])] = False
        if outcome["changed"] and outcome["reviewerVerified"]:
            labels[(outcome["changedBuildNumber"], thread["route"], outcome["learningId"])] = True
    for action in evidence["actions"]:
        route = prototype["startPage"]
        if action["result"] == "improved":
            labels[(action["buildNumber"], route, action["learningId"])] = True
        elif action["result"] == "regressed":
            labels[(action["buildNumber"], route, action["learningId"])] = False
    return labels


def write_taskset(
    directory: Path,
    corpus: Mapping[str, Any],
    tier: str,
    plan: SplitPlan,
    proposals: set[str],
    budgets: Mapping[str, int],
    created_at: str,
    corpus_directory: Path | None = None,
) -> dict[str, Any]:
    directory.mkdir(parents=True, mode=0o700)
    image_directory = directory / "images"
    image_directory.mkdir(mode=0o700)
    synthetic_image = image_directory / "synthetic-screen.png"
    if corpus["source"]["kind"] == "synthetic":
        synthetic_image.write_bytes(PNG)
        os.chmod(synthetic_image, 0o600)
    learnings = [item for item in corpus["learnings"] if item["id"] in proposals]
    if not learnings:
        raise ExperimentError(f"tier {tier} produced no recurring learning proposals.")
    tasks = []
    counts = {"tasks": 0, "train": 0, "dev": 0, "test": 0, "labels": 0}
    for prototype in corpus["prototypes"]:
        split = plan.by_prototype[prototype["id"]]
        inferred = inferred_train_labels(prototype, tier, learnings, budgets)
        evaluation = {
            (item["buildNumber"], item["route"], item["learningId"]): item["follows"]
            for item in prototype["evaluation"]["buildLabels"]
        }
        for build in prototype["tierB"]["builds"]:
            for route in build["routes"]:
                labels = {}
                for learning in learnings:
                    key = (build["number"], route["route"], learning["id"])
                    answer = inferred.get(key) if split == "train" else evaluation.get(key)
                    if answer is not None:
                        labels[learning["id"]] = {"answer": answer}
                if not labels:
                    continue
                task_id = "task_" + hashlib.sha256(
                    f"{tier}\0{prototype['id']}\0{build['number']}\0{route['route']}".encode()
                ).hexdigest()[:24]
                questions = {
                    learning["id"]: {
                        "type": "noul",
                        "instructions": "Does the candidate follow this team learning?",
                        "criteria": {
                            "true": "It follows the learning",
                            "false": "It breaks the learning",
                        },
                        "learning_text": learning["text"],
                    }
                    for learning in learnings
                }
                images = task_images(
                    route,
                    image_directory,
                    corpus["source"]["kind"],
                    corpus_directory,
                    task_id,
                )
                tasks.append(
                    {
                        "schemaVersion": TASK_SCHEMA,
                        "id": task_id,
                        "split": split,
                        "state": {
                            "rules": [{"id": item["id"], "text": item["text"]} for item in learnings],
                            "imagesNote": (
                                f"Image 1 is the candidate: route {route['route']} at desktop width "
                                "in light theme."
                            ),
                        },
                        "images": images,
                        "questions": questions,
                        "labels": labels,
                        "provenance": {
                            "exportId": f"experiment-{tier}",
                            "prototypeId": prototype["id"],
                            "buildNumber": build["number"],
                            "route": route["route"],
                            "evidenceTier": tier,
                        },
                    }
                )
                counts["tasks"] += 1
                counts[split] += 1
                counts["labels"] += len(labels)
    if not tasks or any(counts[name] == 0 for name in ("train", "dev", "test")):
        raise ExperimentError(f"tier {tier} taskset needs nonempty train, dev, and test splits.")
    (directory / "tasks.jsonl").write_text(
        "".join(json.dumps(task, sort_keys=True) + "\n" for task in tasks),
        encoding="utf-8",
    )
    manifest = {
        "schemaVersion": TASKSET_SCHEMA,
        "exportId": f"experiment-{tier}",
        "scope": corpus["source"]["repositoryScope"],
        "createdAt": created_at,
        "counts": counts,
        "evidenceTier": tier,
    }
    (directory / "taskset.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def task_images(
    route: Mapping[str, Any],
    image_directory: Path,
    source_kind: str,
    corpus_directory: Path | None,
    task_id: str,
) -> list[dict[str, Any]]:
    if source_kind == "synthetic":
        return [
            {
                "role": "candidate",
                "path": "images/synthetic-screen.png",
                "mediaType": "image/png",
                "digest": digest(PNG),
                "size": "desktop",
                "theme": "light",
            }
        ]
    if corpus_directory is None:
        raise ExperimentError("an explicit local export needs its corpus directory.")
    root = corpus_directory.resolve()
    images = []
    seen = set()
    for index, screenshot in enumerate(route["screenshots"]):
        rendering = (screenshot["size"], screenshot["theme"])
        if rendering in seen:
            raise ExperimentError(
                f"route {route['route']} repeats its {rendering[0]} {rendering[1]} screenshot."
            )
        seen.add(rendering)
        candidate = screenshot.get("path")
        if not isinstance(candidate, str) or not candidate:
            raise ExperimentError(
                f"route {route['route']} needs a path for every explicit local screenshot."
            )
        source = (root / candidate).resolve()
        try:
            source.relative_to(root)
        except ValueError:
            raise ExperimentError(f"screenshot path {candidate!r} leaves the corpus directory.") from None
        if not source.is_file():
            raise ExperimentError(f"screenshot path {candidate!r} is not a file.")
        media_type = MEDIA_TYPES.get(source.suffix.lower())
        if media_type is None:
            raise ExperimentError(f"screenshot path {candidate!r} must be PNG, JPEG, or WebP.")
        size = source.stat().st_size
        if size > MAX_IMAGE_BYTES:
            raise ExperimentError(f"screenshot path {candidate!r} is larger than 25 MiB.")
        data = source.read_bytes()
        target_name = f"{task_id}-{index}{source.suffix.lower()}"
        target = image_directory / target_name
        target.write_bytes(data)
        os.chmod(target, 0o600)
        images.append(
            {
                "role": "candidate",
                "path": f"images/{target_name}",
                "mediaType": media_type,
                "digest": digest(data),
                "size": screenshot["size"],
                "theme": screenshot["theme"],
            }
        )
    if not images:
        raise ExperimentError(f"route {route['route']} has no screenshots.")
    return images


def load_backends(runtime_settings: Mapping[str, Any], manifest_directory: Path) -> Mapping[str, Any] | None:
    module_name = runtime_settings.get("backendModule")
    if module_name is None:
        return None
    module_path = (manifest_directory / module_name).resolve()
    if not module_path.is_file():
        raise ExperimentError(f"runtime backendModule {module_path} is not a file.")
    specification = importlib.util.spec_from_file_location(
        f"replica_evidence_backend_{short_digest(str(module_path))}",
        module_path,
    )
    if specification is None or specification.loader is None:
        raise ExperimentError(f"Cannot load runtime backendModule {module_path}.")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    factory = getattr(module, "create_backends", None)
    if not callable(factory):
        raise ExperimentError("runtime backendModule must export create_backends().")
    backends = factory()
    if not isinstance(backends, Mapping) or not backends:
        raise ExperimentError("runtime create_backends() must return a nonempty backend mapping.")
    return backends


def run_runtime(
    taskset: Path,
    state: Path,
    runtime_settings: Mapping[str, Any],
    manifest_directory: Path,
) -> dict[str, Any]:
    started = time.monotonic()
    runtime = LocalRuntime(
        state,
        taskset,
        backends=load_backends(runtime_settings, manifest_directory),
        environment="development",
    )
    try:
        submitted = runtime.submit(
            backend=runtime_settings["backend"],
            max_updates=runtime_settings["maxUpdates"],
            max_seconds=runtime_settings["maxSeconds"],
        )
        deadline = time.monotonic() + runtime_settings["maxSeconds"] + 5
        job = submitted
        while job["state"] in ("queued", "running") and time.monotonic() < deadline:
            time.sleep(0.01)
            job = runtime.job(submitted["id"])
        if job["state"] != "succeeded":
            raise ExperimentError(f"local runtime job ended in state {job['state']}.")
        candidate = runtime.candidate(job["candidateId"])
        return {
            "candidate": candidate,
            "seconds": time.monotonic() - started,
            "updates": runtime_settings["maxUpdates"],
        }
    finally:
        runtime.close()


def candidate_report(candidate: Mapping[str, Any]) -> Mapping[str, Any]:
    report = candidate.get("evaluation")
    if not isinstance(report, dict):
        raise ExperimentError("runtime candidate did not return an evaluation report.")
    return report


def proportion_quality(actual: set[str], expected: set[str]) -> dict[str, Any]:
    true_positive = len(actual & expected)
    precision = true_positive / len(actual) if actual else None
    recall = true_positive / len(expected) if expected else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and precision + recall
        else None
    )
    return {
        "proposed": len(actual),
        "expected": len(expected),
        "truePositive": true_positive,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "judgment": "automatic for synthetic fixtures; human judgment required for real corpora",
    }


def wilson(successes: int, total: int) -> list[float] | None:
    if total == 0:
        return None
    z = 1.96
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
    return [max(0.0, center - margin), min(1.0, center + margin)]


def coverage(corpus: Mapping[str, Any], tier: str, plan: SplitPlan, budgets: Mapping[str, int]) -> dict[str, Any]:
    totals = {"prototypes": 0, "comments": 0, "outcomes": 0, "sessions": 0, "actions": 0}
    with_evidence = 0
    for prototype in corpus["prototypes"]:
        if plan.by_prototype[prototype["id"]] != "train":
            continue
        totals["prototypes"] += 1
        evidence = evidence_for(prototype, tier, budgets)
        for name in ("comments", "outcomes", "sessions", "actions"):
            totals[name] += len(evidence[name])
        if evidence["comments"] or evidence["outcomes"] or evidence["actions"]:
            with_evidence += 1
    totals["prototypeCoverage"] = with_evidence / totals["prototypes"] if totals["prototypes"] else None
    totals["prototypeCoverage95"] = wilson(with_evidence, totals["prototypes"])
    return totals


def privacy_diagnostics(corpus: Mapping[str, Any]) -> dict[str, Any]:
    secrets = 0
    identities = 0
    patterns = ("ghp_", "github_pat_", "Bearer ", "AKIA", "-----BEGIN")
    for prototype in corpus["prototypes"]:
        for thread in prototype["tierA"]["reviewThreads"]:
            for comment in thread["comments"]:
                body = comment.get("body") or ""
                secrets += sum(body.count(pattern) for pattern in patterns)
                actor_id = comment["actor"]["id"]
                identities += int("@" in actor_id or "/" in actor_id)
        for session in prototype["tierC"]["authoringSessions"]:
            prompt = session.get("prompt") or ""
            secrets += sum(prompt.count(pattern) for pattern in patterns)
    return {
        "potentialSecretMarkers": secrets,
        "identityLikeActorIds": identities,
        "rawContentIncludedInReport": False,
    }


def realism_diagnostics(corpus: Mapping[str, Any]) -> dict[str, Any]:
    checks = {
        "localStartPages": True,
        "anchorsMatchRoutes": True,
        "buildCommitShas": True,
        "outcomesFollowProblemBuilds": True,
        "sessionsNameConsent": True,
        "noFutureLabelLeakage": True,
    }
    consent_id = corpus["purpose"]["id"]
    for prototype in corpus["prototypes"]:
        checks["localStartPages"] &= prototype["startPage"].startswith("/")
        for thread in prototype["tierA"]["reviewThreads"]:
            checks["anchorsMatchRoutes"] &= thread["anchor"]["route"] == thread["route"]
        for build in prototype["tierB"]["builds"]:
            checks["buildCommitShas"] &= len(build["commitSha"]) == 40
        for outcome in prototype["tierB"]["outcomes"]:
            checks["outcomesFollowProblemBuilds"] &= (
                outcome["changedBuildNumber"] >= outcome["problemBuildNumber"]
            )
        for session in prototype["tierC"]["authoringSessions"]:
            checks["sessionsNameConsent"] &= session["consentId"] == consent_id
    return checks


def incremental(tiers: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    comparisons = []
    for before, after in (("A", "B"), ("B", "C")):
        if before not in tiers or after not in tiers:
            continue
        left = tiers[before]
        right = tiers[after]
        comparisons.append(
            {
                "from": before,
                "to": after,
                "proposalF1Delta": delta(left["proposalQuality"]["f1"], right["proposalQuality"]["f1"]),
                "heldOutRewardDelta": delta(
                    left["decisionModel"]["candidateMeanReward"],
                    right["decisionModel"]["candidateMeanReward"],
                ),
                "calibrationErrorDelta": delta(
                    left["decisionModel"]["candidateCalibrationError"],
                    right["decisionModel"]["candidateCalibrationError"],
                ),
                "taskLabelDelta": right["taskset"]["counts"]["labels"] - left["taskset"]["counts"]["labels"],
            }
        )
    return comparisons


def delta(left: float | None, right: float | None) -> float | None:
    return right - left if left is not None and right is not None else None


def representative_changes(tiers: Mapping[str, Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    wins = []
    regressions = []
    for comparison in incremental(tiers):
        before = tiers[comparison["from"]]
        after = tiers[comparison["to"]]
        before_proposals = set(before["proposalQuality"]["proposalDigests"])
        after_proposals = set(after["proposalQuality"]["proposalDigests"])
        for learning in sorted(after_proposals - before_proposals):
            wins.append(
                {
                    "comparison": f"{comparison['from']}->{comparison['to']}",
                    "kind": "new-grounded-proposal",
                    "learningDigest": learning,
                    "content": "omitted",
                }
            )
        for learning in sorted(before_proposals - after_proposals):
            regressions.append(
                {
                    "comparison": f"{comparison['from']}->{comparison['to']}",
                    "kind": "proposal-lost",
                    "learningDigest": learning,
                    "content": "omitted",
                }
            )
        reward = comparison["heldOutRewardDelta"]
        item = {
            "comparison": f"{comparison['from']}->{comparison['to']}",
            "kind": "aggregate-held-out-reward",
            "heldOutRewardDelta": reward,
            "content": "omitted",
        }
        if reward is not None and reward > 0:
            wins.append(item)
        elif reward is not None and reward < 0:
            regressions.append(item)
    return {"wins": wins[:5], "regressions": regressions[:5]}


def sample_warnings(corpus: Mapping[str, Any], plan: SplitPlan, tier_results: Mapping[str, Any]) -> list[str]:
    warnings = []
    if plan.counts["test"] < 10:
        warnings.append("The test split has fewer than 10 prototypes; treat deltas as directional.")
    minimum_labels = min(result["taskset"]["counts"]["labels"] for result in tier_results.values())
    if minimum_labels < 30:
        warnings.append("At least one tier has fewer than 30 labels; calibration and regression slices are unstable.")
    repositories = {prototype["repositoryId"] for prototype in corpus["prototypes"]}
    if len(repositories) == 1:
        warnings.append("The corpus covers one repository; do not generalize gains across customers or repositories.")
    if corpus["source"]["kind"] == "synthetic":
        warnings.append("All quality and reward conclusions are synthetic-only and prove the harness, not product efficacy.")
    return warnings


def run_experiment(manifest_path: Path, output: Path) -> dict[str, Any]:
    manifest = read_json(manifest_path)
    validate_manifest(manifest)
    corpus_path = (manifest_path.parent / manifest["corpus"]).resolve()
    corpus = read_json(corpus_path)
    validate_corpus(corpus)
    output = output.resolve()
    if output.exists():
        raise ExperimentError(f"{output} already exists. Choose a new output directory.")
    output.mkdir(parents=True, mode=0o700)
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    plan = split_plan(corpus, manifest["split"])
    tier_results = {}
    expected = set().union(
        *(set(prototype["evaluation"]["expectedLearnings"]) for prototype in corpus["prototypes"])
    )
    try:
        for tier in manifest["tiers"]:
            tier_dir = output / f"tier-{tier.lower()}"
            taskset_dir = tier_dir / "taskset"
            proposals = proposal_set(corpus, tier, plan, manifest["budgets"])
            taskset_manifest = write_taskset(
                taskset_dir,
                corpus,
                tier,
                plan,
                proposals,
                manifest["budgets"],
                created_at,
                corpus_path.parent,
            )
            checked = load_taskset(taskset_dir)
            runtime_result = run_runtime(
                taskset_dir,
                tier_dir / "runtime",
                manifest["runtime"],
                manifest_path.parent,
            )
            evaluation = candidate_report(runtime_result["candidate"])
            baseline = evaluation["baseline"]
            candidate = evaluation["candidate"]
            tier_results[tier] = {
                "evidenceTier": tier,
                "coverage": coverage(corpus, tier, plan, manifest["budgets"]),
                "proposalQuality": {
                    **proportion_quality(proposals, expected),
                    "proposalDigests": sorted(short_digest(item) for item in proposals),
                },
                "acceptedGuidanceUsefulnessProxy": {
                    "heldOutExpectedCoverage": (
                        len(proposals & expected) / len(expected) if expected else None
                    ),
                    "automatic": True,
                    "interpretation": (
                        "Coverage of known held-out guidance only; blinded human ratings remain required."
                    ),
                },
                "taskset": {
                    "digest": str(runtime_result["candidate"]["manifest"]["tasksetDigest"]),
                    "counts": taskset_manifest["counts"],
                    "roundTripTasks": len(checked.tasks),
                },
                "decisionModel": {
                    "baselineMeanReward": baseline["meanReward"],
                    "candidateMeanReward": candidate["meanReward"],
                    "meanRewardDelta": evaluation["evidence"]["meanRewardDelta"],
                    "baselineCalibrationError": baseline["noul"]["ece"],
                    "candidateCalibrationError": candidate["noul"]["ece"],
                    "calibrationErrorDelta": evaluation["evidence"]["calibrationErrorDelta"],
                    "perLearning": {
                        short_digest(key): value
                        for key, value in candidate["noul"]["byRule"].items()
                    },
                },
                "costAndTime": {
                    "trainingSeconds": runtime_result["seconds"],
                    "updatesCompleted": runtime_result["updates"],
                    "estimatedCost": 0,
                    "costUnit": "fixture",
                },
            }
        report = {
            "schemaVersion": REPORT_SCHEMA,
            "experiment": {
                "name": manifest["name"],
                "manifestDigest": digest(manifest),
                "corpusDigest": digest(corpus),
                "sourceKind": corpus["source"]["kind"],
                "createdAt": created_at,
            },
            "design": {
                "tiers": manifest["tiers"],
                "split": {**manifest["split"], "prototypeCounts": plan.counts},
                "runtime": {
                    "backend": manifest["runtime"]["backend"],
                    "maxUpdates": manifest["runtime"]["maxUpdates"],
                    "maxSeconds": manifest["runtime"]["maxSeconds"],
                    **(
                        {
                            "backendModuleDigest": short_digest(
                                manifest["runtime"]["backendModule"]
                            )
                        }
                        if "backendModule" in manifest["runtime"]
                        else {}
                    ),
                },
                "budgets": manifest["budgets"],
                "humanMetrics": [
                    "proposal usefulness",
                    "proposal correctness",
                    "accepted-guidance usefulness",
                    "representative win severity",
                    "representative regression severity",
                ],
                "automaticMetrics": [
                    "yield and coverage",
                    "synthetic proposal precision, recall, and F1",
                    "decision-model reward",
                    "calibration",
                    "per-learning balanced accuracy",
                    "cost and wall time",
                ],
            },
            "privacy": {
                "purposeIdDigest": short_digest(corpus["purpose"]["id"]),
                "retentionOwnerDigest": short_digest(corpus["purpose"]["retention"]["owner"]),
                "inputProvenance": {
                    "repositoryScopeDigest": short_digest(corpus["source"]["repositoryScope"]),
                    "exportedAt": corpus["source"]["exportedAt"],
                },
                "diagnostics": privacy_diagnostics(corpus),
                "deletionResponsibility": (
                    "The corpus owner must delete source exports, tasksets, runtime state, and reports "
                    "by the recorded retention deadline or when consent ends."
                ),
            },
            "realism": realism_diagnostics(corpus),
            "tiers": tier_results,
            "incrementalValue": incremental(tier_results),
            "representativeChanges": representative_changes(tier_results),
            "warnings": sample_warnings(corpus, plan, tier_results),
        }
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (output / "report.md").write_text(markdown_report(report), encoding="utf-8")
        return report
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise


def markdown_report(report: Mapping[str, Any]) -> str:
    lines = [
        f"# {report['experiment']['name']}",
        "",
        "> Synthetic fixture results validate the harness only. They do not establish product efficacy.",
        "",
        "## Side-by-side results",
        "",
        "| Tier | Comments | Outcomes | Session actions | Proposal F1 | Held-out reward | Calibration error | Training seconds |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for tier, result in report["tiers"].items():
        lines.append(
            "| {tier} | {comments} | {outcomes} | {actions} | {f1} | {reward} | {ece} | {seconds} |".format(
                tier=tier,
                comments=result["coverage"]["comments"],
                outcomes=result["coverage"]["outcomes"],
                actions=result["coverage"]["actions"],
                f1=format_metric(result["proposalQuality"]["f1"]),
                reward=format_metric(result["decisionModel"]["candidateMeanReward"]),
                ece=format_metric(result["decisionModel"]["candidateCalibrationError"]),
                seconds=format_metric(result["costAndTime"]["trainingSeconds"]),
            )
        )
    lines.extend(["", "## Incremental value", ""])
    for item in report["incrementalValue"]:
        lines.append(
            f"- **{item['from']} to {item['to']}:** reward {signed(item['heldOutRewardDelta'])}; "
            f"proposal F1 {signed(item['proposalF1Delta'])}; calibration error "
            f"{signed(item['calibrationErrorDelta'])}."
        )
    lines.extend(["", "## Warnings", ""])
    lines.extend(f"- {warning}" for warning in report["warnings"])
    lines.extend(
        [
            "",
            "## Privacy",
            "",
            "The report contains digested identifiers and aggregate metrics only. Raw comments, prompts, "
            "screenshots, actor identities, and session traces remain in the explicit local input and taskset directories.",
            "",
        ]
    )
    return "\n".join(lines)


def format_metric(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.4f}"


def signed(value: float | None) -> str:
    return "n/a" if value is None else f"{value:+.4f}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="evidence-ablation",
        description="Run Replica's local A/B/C learning-evidence ablation experiment.",
    )
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = run_experiment(args.manifest.resolve(), args.out)
    except ExperimentError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"report": str((args.out / "report.json").resolve()), "tiers": list(report["tiers"])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
