import { access } from "node:fs/promises"
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
    vi.mocked(access).mockResolvedValue(undefined)
  })

  it("reads database learnings without a local configuration", async () => {
    vi.mocked(access).mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ text: "Useful guidance", memories: [] })
    const learningDatabaseUrl = "postgresql://learning.example/replica"

    const result = await getLearningOverview({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      learningDatabaseUrl,
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
      viewer: "human:mona",
    })

    expect(result.recall.text).toBe("Useful guidance")
    expect(runLearningCommand).toHaveBeenCalledTimes(3)
    for (const [arguments_, options] of vi.mocked(runLearningCommand).mock.calls) {
      expect(arguments_).not.toContain(learningDatabaseUrl)
      expect(options).toMatchObject({ learningDatabaseUrl })
    }
  })

  it("returns an empty overview for a missing local store", async () => {
    vi.mocked(access).mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }))

    const result = await getLearningOverview({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
      viewer: "human:mona",
    })

    expect(result.suggestions).toEqual([])
    expect(runLearningCommand).not.toHaveBeenCalled()
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
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ text: "", memories: [] })
      .mockResolvedValueOnce({
        events: [
          {
            id: "event-1",
            episodeId: "episode-1",
            at: "2026-11-01T10:00:00.000Z",
            payload: { commentId: 17, body: "The field needs a visible label." },
          },
        ],
      })
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
      repositoryScope: "github.com/repositories/123",
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
      events: [
        {
          id: "event-1",
          episodeId: "episode-1",
          at: "2026-11-01T10:00:00.000Z",
          payload: { commentId: 17, body: "The field needs a visible label." },
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
    for (const [arguments_] of vi.mocked(runLearningCommand).mock.calls) {
      expect(arguments_).toEqual(
        expect.arrayContaining([
          "--repository",
          "github.com/repositories/123",
          "--legacy-repository",
          "github.com/repositories/11111111-2222-4333-8444-555555555555",
        ]),
      )
    }
  })

  it("propagates an inaccessible store instead of reporting an empty overview", async () => {
    vi.mocked(access).mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }))

    await expect(
      getLearningOverview({
        applicationRoot: "/app",
        cliPath: "/app/replica-learning.mjs",
        nodePath: "/node",
        repositoryId: "11111111-2222-4333-8444-555555555555",
        repositoryScope: "github.com/repositories/123",
        root: "/private/learning",
        staticDirectories: [],
        viewer: "human:mona",
      }),
    ).rejects.toMatchObject({ code: "EACCES" })
  })

  it("returns migration redaction follow-ups again when the overview reloads", async () => {
    const learningId = "mem_111111111111111111111111"
    const exportId = "exp_222222222222222222222222"
    const destination = "private/exports/team.json"
    const followUps = {
      memoriesNeedingRebuild: [learningId],
      exportsToFollowUp: [
        {
          id: exportId,
          purpose: "instruction",
          destination,
        },
      ],
    }
    vi.mocked(runLearningCommand).mockImplementation((arguments_) => {
      if (arguments_[0] === "memories") return Promise.resolve([])
      if (arguments_[0] === "recall") return Promise.resolve({ text: "", memories: [] })
      if (arguments_[0] === "status")
        return Promise.resolve({ migrationRedactionFollowUps: followUps })
      throw new Error(`Unexpected learning command: ${arguments_[0]}`)
    })
    const input = {
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
      viewer: "human:mona",
    }

    const first = await getLearningOverview(input)
    const reloaded = await getLearningOverview(input)
    for (const result of [first, reloaded]) {
      expect(result.loadError).toContain(learningId)
      expect(result.loadError).toContain(exportId)
      expect(result.loadError).toContain(destination)
    }
    const statusCalls = vi
      .mocked(runLearningCommand)
      .mock.calls.filter(([arguments_]) => arguments_[0] === "status")
    expect(statusCalls).toHaveLength(2)
    for (const [arguments_] of statusCalls)
      expect(arguments_).toEqual(
        expect.arrayContaining([
          "--repository",
          "github.com/repositories/123",
          "--legacy-repository",
          "github.com/repositories/11111111-2222-4333-8444-555555555555",
        ]),
      )
  })

  it("loads observations and the repository snapshot once for all suggestions", async () => {
    function proposal(id: string, eventId: string, commentId: number) {
      return {
        withheld: false,
        record: {
          id,
          state: "proposed" as const,
          content: `Guidance ${id}`,
          reviewDigest: `sha256:${(id === "mem_1" ? "a" : "b").repeat(64)}`,
          evidence: [
            {
              episodeId: `episode-${commentId}`,
              eventIds: [eventId],
              source: {
                kind: "hub_review_comments",
                repositoryId: "11111111-2222-4333-8444-555555555555",
                commentId,
              },
            },
          ],
          contradictions: [],
          proposal: { lifecycle: { targets: [] } },
        },
        status: { recallEligible: false, problems: [], conflicts: [] },
      }
    }
    const memories = [proposal("mem_1", "event-1", 17), proposal("mem_2", "event-2", 18)]
    vi.mocked(runLearningCommand)
      .mockResolvedValueOnce(memories)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ text: "", memories: [] })
      .mockResolvedValueOnce({
        events: [
          {
            id: "event-1",
            episodeId: "episode-17",
            at: "2026-11-01T10:00:00Z",
            payload: { commentId: 17, body: "one" },
          },
          {
            id: "event-2",
            episodeId: "episode-18",
            at: "2026-11-01T11:00:00Z",
            payload: { commentId: 18, body: "two" },
          },
        ],
      })
    const resolveEvidence = vi.fn().mockResolvedValue([])

    await getLearningOverview({
      applicationRoot: "/app",
      cliPath: "/app/replica-learning.mjs",
      evidenceSource: { resolveEvidence },
      nodePath: "/node",
      repositoryId: "11111111-2222-4333-8444-555555555555",
      repositoryScope: "github.com/repositories/123",
      root: "/private/learning",
      staticDirectories: [],
      viewer: "human:mona",
    })

    expect(resolveEvidence).toHaveBeenCalledOnce()
    expect(vi.mocked(runLearningCommand)).toHaveBeenCalledTimes(4)
  })
})
