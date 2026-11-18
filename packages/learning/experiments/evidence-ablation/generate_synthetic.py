#!/usr/bin/env python3
"""Generate one deterministic Replica prototype-evolution world and its A/B/C projections."""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "synthetic"
LEARNINGS = [
    (
        "mem_111111111111111111111111",
        "Put a visible label above every form field.",
        "field-labels",
        ["visible label", "field label", "label above"],
    ),
    (
        "mem_222222222222222222222222",
        "Use the shared primary action instead of an unstyled button.",
        "primary-action",
        ["primary action", "unstyled button", "shared button"],
    ),
    (
        "mem_333333333333333333333333",
        "Keep the narrow layout usable without horizontal scrolling.",
        "narrow-layout",
        ["horizontal scroll", "narrow layout", "phone width"],
    ),
]


def timestamp(day: int, hour: int = 12) -> str:
    return f"2026-09-{day:02d}T{hour:02d}:00:00Z"


def actor(kind: str, identifier: str) -> dict:
    return {"kind": kind, "id": identifier}


def prototype(index: int) -> dict:
    repository = "repo-alpha" if index < 7 else "repo-beta"
    first = LEARNINGS[index % len(LEARNINGS)]
    second = LEARNINGS[(index + 1) % len(LEARNINGS)]
    noisy = LEARNINGS[(index + 2) % len(LEARNINGS)]
    route = "/" if index % 2 == 0 else "/requests?view=open#queue"
    reviewer = actor("human", f"reviewer-{index % 4}")
    agent = actor("agent", "copilot-author")
    root_body = f"The {first[2].replace('-', ' ')} is missing. Please add a {first[3][0]}."
    if first[2] == "primary-action":
        root_body = "The main action does not match the repository guidance."
    if first[2] == "narrow-layout":
        root_body = "This page breaks when I review it on a phone."
    reply_body = "Updated in the next Build and checked in both captured layouts."
    if index == 2:
        root_body = f"This might be intentional, but the {noisy[3][0]} feels inconsistent."
    comments = [
        {
            "id": f"comment-{index}-root",
            "kind": "root",
            "body": root_body,
            "createdAt": timestamp(index + 1),
            "actor": reviewer,
        },
        {
            "id": f"comment-{index}-reply",
            "kind": "reply",
            "body": reply_body,
            "createdAt": timestamp(index + 2),
            "editedAt": timestamp(index + 2, 14),
            "actor": agent,
        },
    ]
    if index == 3:
        comments.append(
            {
                "id": f"comment-{index}-deleted",
                "kind": "reply",
                "body": None,
                "createdAt": timestamp(index + 2, 15),
                "deletedAt": timestamp(index + 2, 16),
                "actor": actor("human", "github-user:legacy"),
            }
        )
    builds = []
    for number in (1, 2, 3):
        builds.append(
            {
                "number": number,
                "commitSha": f"{index + 1:02x}{number:02x}".ljust(40, "a"),
                "createdAt": timestamp(index + number),
                "routes": [
                    {
                        "route": route,
                        "screenshots": [
                            {
                                "size": "desktop",
                                "theme": "light",
                                "path": "synthetic-screen.png",
                            },
                            {
                                "size": "desktop",
                                "theme": "dark",
                                "path": "synthetic-screen.png",
                            },
                            {
                                "size": "narrow",
                                "theme": "light",
                                "path": "synthetic-screen.png",
                            },
                            {
                                "size": "narrow",
                                "theme": "dark",
                                "path": "synthetic-screen.png",
                            },
                        ],
                    }
                ],
            }
        )
    events = [
        {"kind": "resolved", "at": timestamp(index + 3), "actor": reviewer},
    ]
    verified = first[2] != "narrow-layout"
    changed = index != 8
    if index in (4, 8):
        events.extend(
            [
                {"kind": "reopened", "at": timestamp(index + 4), "actor": reviewer},
                {"kind": "resolved-again", "at": timestamp(index + 5), "actor": reviewer},
            ]
        )
    session_actions = [
        {
            "kind": "inspect-guidance",
            "at": timestamp(index + 1, 9),
            "learningId": first[0],
            "buildNumber": 1,
            "result": "unchanged",
        },
        {
            "kind": "edit",
            "at": timestamp(index + 2, 9),
            "learningId": first[0],
            "buildNumber": 2,
            "result": "improved" if changed else "unchanged",
        },
        {
            "kind": "capture-build",
            "at": timestamp(index + 3, 9),
            "learningId": second[0],
            "buildNumber": 3,
            "result": "regressed" if index in (5, 9) else "improved",
        },
    ]
    if index == 8:
        session_actions.append(
            {
                "kind": "respond-to-review",
                "at": timestamp(index + 3, 10),
                "learningId": LEARNINGS[0][0],
                "buildNumber": 2,
                "result": "improved",
            }
        )
    if index in (2, 8):
        session_actions.append(
            {
                "kind": "respond-to-review",
                "at": timestamp(index + 3, 11),
                "learningId": LEARNINGS[1][0],
                "buildNumber": 2,
                "result": "improved",
            }
        )
    expected = [first[0], second[0]]
    labels = []
    for number in (1, 2, 3):
        labels.append(
            {
                "buildNumber": number,
                "route": route,
                "learningId": first[0],
                "follows": number >= 2 and changed,
                "judgment": "synthetic-ground-truth",
            }
        )
        labels.append(
            {
                "buildNumber": number,
                "route": route,
                "learningId": second[0],
                "follows": not (number == 3 and index in (5, 9)),
                "judgment": "synthetic-ground-truth",
            }
        )
    return {
        "id": f"prototype-{index:02d}",
        "repositoryId": repository,
        "name": f"Request triage {index}",
        "branch": f"prototype/request-triage-{index}",
        "startPage": route,
        "templates": [
            {"id": "default", "name": "Request queue", "route": route},
            {"id": "empty", "name": "Empty state", "route": "/requests?view=empty"},
        ],
        "tierA": {
            "reviewThreads": [
                {
                    "id": f"thread-{index}",
                    "buildNumber": 1,
                    "route": route,
                    "anchor": {
                        "schemaVersion": "replica.review-anchor/v1",
                        "kind": "element" if index % 2 == 0 else "area",
                        "route": route,
                    },
                    "comments": comments,
                }
            ]
        },
        "tierB": {
            "builds": builds,
            "outcomes": [
                {
                    "threadId": f"thread-{index}",
                    "learningId": first[0],
                    "problemBuildNumber": 1,
                    "changedBuildNumber": 2,
                    "events": events,
                    "reviewerVerified": verified,
                    "changed": changed,
                }
            ],
        },
        "tierC": {
            "authoringSessions": [
                {
                    "id": f"session-{index}",
                    "purpose": "evaluation",
                    "consentId": "synthetic-evidence-study",
                    "startedAt": timestamp(index + 1, 8),
                    "prompt": (
                        "Update the request triage prototype using the repository's design-system "
                        "guidance and keep the existing start page and templates."
                    ),
                    "actions": session_actions,
                }
            ]
        },
        "evaluation": {"expectedLearnings": expected, "buildLabels": labels},
    }


def main() -> None:
    FIXTURE.mkdir(parents=True, exist_ok=True)
    corpus = {
        "schemaVersion": "replica.learning-evidence-corpus/v1",
        "purpose": {
            "id": "synthetic-evidence-study",
            "description": "Evaluate evidence-tier yield and usefulness without customer data.",
            "consentRecordedAt": "2026-09-01T00:00:00Z",
            "approvedBy": "synthetic-fixture-owner",
            "allowedUses": ["evaluation", "analytics", "training"],
            "retention": {
                "owner": "synthetic-fixture-owner",
                "deleteBy": "2027-09-01T00:00:00Z",
            },
        },
        "source": {
            "kind": "synthetic",
            "repositoryScope": "github.com/synthetic/replica-prototypes",
            "exportedAt": "2026-10-01T00:00:00Z",
        },
        "learnings": [
            {"id": item[0], "text": item[1], "theme": item[2], "fixtureTerms": item[3]}
            for item in LEARNINGS
        ],
        "prototypes": [prototype(index) for index in range(1, 13)],
    }
    manifest = {
        "schemaVersion": "replica.learning-evidence-experiment/v1",
        "name": "Synthetic Replica evidence ablation",
        "corpus": "corpus.json",
        "tiers": ["A", "B", "C"],
        "split": {
            "unit": "prototype",
            "seed": 20261118,
            "train": 0.6,
            "dev": 0.2,
            "test": 0.2,
        },
        "runtime": {"backend": "fixture", "maxUpdates": 8, "maxSeconds": 30},
        "budgets": {"maxComments": 500, "maxOutcomes": 500, "maxSessionActions": 1000},
        "privacy": {"reportIdentifiers": "digests-only", "includeRawContent": False},
    }
    (FIXTURE / "corpus.json").write_text(json.dumps(corpus, indent=2) + "\n", encoding="utf-8")
    (FIXTURE / "experiment.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
