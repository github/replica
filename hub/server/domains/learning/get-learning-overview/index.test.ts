import { beforeEach, describe, expect, it, vi } from "vitest"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root"
import { getLearningOverview } from "."

vi.mock("node:fs/promises", () => ({ access: vi.fn() }))
vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../utils/validate-private-storage-root", () => ({
  validatePrivateStorageRoot: vi.fn(),
}))

describe("getLearningOverview()", () => {
  beforeEach(() => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repositories/repo")
  })

  it("uses only the review source's exact event resolution for displayed evidence", async () => {
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce([
        {
          withheld: false,
          record: {
            id: "mem_1",
            state: "proposed",
            content: "Use visible labels.",
            reviewDigest: `sha256:${"a".repeat(64)}`,
            evidence: [
              {
                episodeId: "episode-1",
                eventIds: ["event-1"],
                source: {
                  kind: "hub_review_comments",
                  repositoryId: "11111111-2222-4333-8444-555555555555",
                  commentId: 17,
                },
              },
              {
                episodeId: "foreign-episode",
                eventIds: ["foreign-event"],
                source: { kind: "hub_review_comments", repositoryId: "foreign", commentId: 18 },
              },
            ],
            contradictions: [],
            support: { distinctReviewers: 2, distinctPrototypes: 1 },
            proposal: { lifecycle: { targets: [] } },
          },
          status: {
            recallEligible: false,
            problems: [],
            conflicts: [],
          },
        },
      ])
      .mockResolvedValueOnce({ text: "", memories: [] })
    const resolveEvidence = vi.fn().mockResolvedValue([
      {
        referenceIndex: 0,
        evidence: [
          {
            eventId: "event-1",
            commentId: 17,
            body: "The field needs a visible label.",
            authorLogin: "reviewer",
            authorAvatarUrl: null,
            prototypeId: "prototype-1",
            prototypeName: "Signup",
            createdAt: "2026-11-01T10:00:00.000Z",
          },
        ],
      },
    ])

    const result = await getLearningOverview({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      evidenceSource: { resolveEvidence },
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      root: "/private/learning",
      staticDirectories: [],
      viewer: "github:mona",
    })

    expect(resolveEvidence).toHaveBeenCalledWith({
      repositoryId: "11111111-2222-4333-8444-555555555555",
      references: [
        {
          episodeId: "episode-1",
          eventIds: ["event-1"],
          source: {
            kind: "hub_review_comments",
            repositoryId: "11111111-2222-4333-8444-555555555555",
            commentId: 17,
          },
        },
        {
          episodeId: "foreign-episode",
          eventIds: ["foreign-event"],
          source: { kind: "hub_review_comments", repositoryId: "foreign", commentId: 18 },
        },
      ],
    })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]?.evidence).toEqual([
      {
        eventId: "event-1",
        commentId: 17,
        body: "The field needs a visible label.",
        authorLogin: "reviewer",
        authorAvatarUrl: null,
        prototypeId: "prototype-1",
        prototypeName: "Signup",
        createdAt: "2026-11-01T10:00:00.000Z",
      },
    ])
    expect(result.suggestions[0]?.otherEvidenceCount).toBe(1)
  })
})
