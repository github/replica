import { describe, expect, it, vi } from "vitest"

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock("../../review-comments/capture-repository-review-snapshot/index.ts", () => ({
  captureRepositoryReviewSnapshot: capture,
}))

import { createReviewCommentLearningSource } from "."

const repositoryId = "11111111-2222-4333-8444-555555555555"
const prototypeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const capturedAt = new Date("2026-11-13T10:00:00Z")

function snapshot() {
  const author = {
    userId: "22222222-2222-4222-8222-222222222222",
    login: "mona",
    name: "Mona",
  }
  return {
    snapshotId: "33333333-3333-4333-8333-333333333333",
    capturedAt,
    repository: { id: repositoryId, nameWithOwner: "team/design" },
    threads: [
      {
        id: 101,
        repositoryId,
        prototype: { id: prototypeId, name: "Design", branch: "design" },
        buildNumber: 7,
        anchor: {},
        activityVersion: 1,
        createdAt: capturedAt,
        updatedAt: capturedAt,
        resolvedAt: null,
        resolvedBy: null,
        root: {
          id: 101,
          storageId: "44444444-4444-4444-8444-444444444444",
          rootId: null,
          body: "Please align this section.",
          author,
          createdAt: capturedAt,
          updatedAt: capturedAt,
          editedAt: null,
          deletedAt: null,
        },
        replies: [],
        resolutionHistory: [],
      },
    ],
  }
}

describe("createReviewCommentLearningSource()", () => {
  it("resolves only evidence whose source and observed comment version match", async () => {
    const value = snapshot()
    capture.mockResolvedValue(value)
    const source = createReviewCommentLearningSource({} as never, "https://hub.example.com")

    const result = await source.resolveEvidence({
      repositoryId,
      references: [
        {
          episodeId: "episode-1",
          eventIds: ["event-1", "event-2"],
          source: {
            kind: "hub_review_comments",
            hubOrigin: "https://hub.example.com",
            repositoryId,
            prototypeId,
            threadId: 101,
            commentId: 101,
          },
        },
        {
          episodeId: "episode-1",
          eventIds: ["event-1"],
          source: {
            kind: "hub_review_comments",
            hubOrigin: "https://hub.example.com",
            repositoryId,
            prototypeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            threadId: 101,
            commentId: 101,
          },
        },
      ],
      events: [
        {
          id: "event-1",
          episodeId: "episode-1",
          at: capturedAt.toISOString(),
          payload: { commentId: 101, body: "Observed body" },
        },
        {
          id: "event-2",
          episodeId: "other-episode",
          at: capturedAt.toISOString(),
          payload: { commentId: 101, body: "Wrong episode" },
        },
      ],
    })

    expect(result[0]?.evidence).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        commentId: 101,
        body: "Observed body",
        authorLogin: "mona",
        prototypeId,
      }),
    ])
    expect(result[1]?.evidence).toEqual([])
  })
})
