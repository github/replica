import { access } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { runLearningCommand } from "../../../integrations/learning/run-learning-command"
import { validatePrivateStorageRoot } from "../../../utils/validate-private-storage-root"
import type { ReviewCommentLearningSource } from "../review-comment-learning-source/types.ts"
import { getLearningHistory } from "."

vi.mock("node:fs/promises", () => ({ access: vi.fn() }))
vi.mock("../../../integrations/learning/run-learning-command", () => ({
  runLearningCommand: vi.fn(),
}))
vi.mock("../../../utils/validate-private-storage-root", () => ({
  validatePrivateStorageRoot: vi.fn(),
}))

describe("getLearningHistory()", () => {
  beforeEach(() => {
    vi.mocked(validatePrivateStorageRoot).mockResolvedValue("/private/learning/repositories/repo")
    vi.mocked(access).mockResolvedValue(undefined)
  })

  it("lists each decision once, including edits, reinstatements, and damaged versions", async () => {
    vi.mocked(runLearningCommand).mockResolvedValueOnce({
      withheld: false,
      record: { evidence: [] },
      versions: [
        {
          version: 1,
          state: "proposed",
          proposal: { proposedAt: "2026-11-01T00:00:00.000Z", proposedBy: { id: "agent:x" } },
        },
        {
          version: 2,
          state: "accepted",
          digest: "sha256:v2",
          accepted: { at: "2026-11-02T00:00:00.000Z", by: { id: "github:mona" } },
        },
        {
          version: 3,
          state: "accepted",
          digest: "sha256:v3",
          accepted: {
            at: "2026-11-03T00:00:00.000Z",
            by: { id: "github:hubot" },
            decision: "edit",
            note: "Clearer wording.",
            reviewedDigest: "sha256:v2",
          },
        },
        {
          version: 4,
          state: "accepted",
          digest: "sha256:v4",
          accepted: {
            at: "2026-11-03T00:00:00.000Z",
            by: { id: "github:hubot" },
            decision: "edit",
            note: "Clearer wording.",
            reviewedDigest: "sha256:v2",
          },
        },
        {
          version: 5,
          state: "retired",
          retired: { at: "2026-11-04T00:00:00.000Z", reason: "No longer true." },
        },
        { version: 6, state: "accepted", withheld: true },
        { withheld: true },
      ],
    })
    vi.mocked(runLearningCommand).mockResolvedValueOnce({ outcomes: [] })

    const result = await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.decisions.map((decision) => [decision.change, decision.by])).toEqual([
      ["proposed", "agent:x"],
      ["accepted", "mona"],
      ["edited", "hubot"],
      ["retired", null],
      ["reinstated", null],
    ])
    expect(result.decisions[2]?.reason).toBe("Clearer wording.")
    expect(vi.mocked(runLearningCommand).mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["show", "mem_1", "--history"]),
    )
  })

  it("never passes a learning ID that looks like a command option", async () => {
    vi.mocked(runLearningCommand).mockClear()

    await expect(
      getLearningHistory({
        applicationRoot: "/app",
        cliPath: "/app/replica-learning.mjs",
        learningId: "--history",
        nodePath: "/node",
        repositoryId: "11111111-2222-4333-8444-555555555555",
        repositoryScope: "github.com/repositories/123",
        root: "/private/learning",
        staticDirectories: [],
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    expect(runLearningCommand).not.toHaveBeenCalled()
  })

  it("shows only how the current wording was scored", async () => {
    const digest = "c".repeat(64)
    const outcome = {
      id: "score_1",
      commitSha: "a".repeat(40),
      prototypeId: "proto_1",
      efficiency: 2,
      followed: "followed",
      reasoning: "The form kept its labels.",
      issue: "The rule did not say where the label goes.",
      scoredAt: "2026-11-05T00:00:00.000Z",
    }
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce({
        withheld: false,
        record: {},
        versions: [
          { version: 1, state: "accepted", contentDigest: "first wording" },
          { version: 2, state: "accepted", contentDigest: "second wording" },
          { version: 3, state: "retired", contentDigest: "second wording" },
          { version: 4, state: "accepted", contentDigest: "second wording" },
        ],
      })
      .mockResolvedValueOnce({
        outcomes: [
          { ...outcome, id: "score_old", version: 1 },
          {
            ...outcome,
            version: 2,
            after: { sha256: `sha256:${digest}`, route: "/checkout", consentGrantId: "grant-1" },
          },
        ],
      })

    const result = await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.outcomes).toEqual([
      {
        ...outcome,
        after: { sha256: digest, route: "/checkout", consentGrantId: "grant-1" },
      },
    ])
  })

  it("separates supporting and opposing comments and counts the ones it cannot show", async () => {
    const comment = {
      commentId: 1,
      body: "Comment",
      authorLogin: "mona",
      authorAvatarUrl: null,
      prototypeId: "proto_1",
      prototypeName: "Checkout",
      createdAt: "2026-11-01T00:00:00.000Z",
    }
    const resolveEvidence = vi
      .fn<ReviewCommentLearningSource["resolveEvidence"]>()
      .mockResolvedValue([
        { referenceIndex: 0, evidence: [{ ...comment, eventId: "evt_1" }] },
        { referenceIndex: 1, evidence: [{ ...comment, eventId: "evt_3" }] },
      ])
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce({
        withheld: false,
        record: {
          evidence: [{ episodeId: "ep_1", eventIds: ["evt_1", "evt_2"], source: {} }],
          contradictions: [{ episodeId: "ep_1", eventIds: ["evt_3"], source: {} }],
        },
        versions: [],
      })
      .mockResolvedValueOnce({ outcomes: [] })
      .mockResolvedValueOnce({
        events: [
          {
            id: "evt_1",
            episodeId: "ep_1",
            at: "2026-11-01T00:00:00.000Z",
            payload: { commentId: 1, body: "A" },
          },
          {
            id: "evt_2",
            episodeId: "ep_1",
            at: "2026-11-01T00:00:00.000Z",
            payload: { label: "useful" },
          },
          {
            id: "evt_3",
            episodeId: "ep_1",
            at: "2026-11-01T00:00:00.000Z",
            payload: { commentId: 3, body: "B" },
          },
        ],
      })

    const result = await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      evidenceSource: { resolveEvidence },
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    expect(result.evidence.map((entry) => entry.eventId)).toEqual(["evt_1"])
    expect(result.otherEvidenceCount).toBe(1)
    expect(result.contradictions.map((entry) => entry.eventId)).toEqual(["evt_3"])
    expect(result.otherContradictionsCount).toBe(0)
    expect(resolveEvidence.mock.calls[0]?.[0].events.map((event) => event.id)).toEqual([
      "evt_1",
      "evt_3",
    ])
  })

  it("never passes a stored event ID that looks like a command option", async () => {
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce({
        withheld: false,
        record: {
          evidence: [{ episodeId: "ep_1", eventIds: ["evt_1", "--purpose", "evt 2"], source: {} }],
        },
        versions: [],
      })
      .mockResolvedValueOnce({ outcomes: [] })
      .mockResolvedValueOnce({ events: [] })

    await getLearningHistory({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      evidenceSource: { resolveEvidence: vi.fn().mockResolvedValue([]) },
      learningId: "mem_1",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
    })

    const observationArguments = vi.mocked(runLearningCommand).mock.calls[2]?.[0] ?? []
    expect(observationArguments.filter((argument) => argument === "--event")).toHaveLength(1)
    expect(observationArguments).toContain("evt_1")
    expect(observationArguments).not.toContain("evt 2")
  })
})
