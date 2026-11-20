import { describe, expect, it, vi } from "vitest"
import type { RepositoryReviewSnapshot } from "../../review-comments/types"

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }))
vi.mock("../../review-comments/capture-repository-review-snapshot/index.ts", () => ({
  captureRepositoryReviewSnapshot: capture,
}))

import { createReviewCommentLearningSource } from "."

const repositoryId = "11111111-2222-4333-8444-555555555555"
const prototypeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const capturedAt = new Date("2026-11-13T10:00:00Z")

function snapshot(): RepositoryReviewSnapshot {
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
        storageId: "77777777-7777-4777-8777-777777777777",
        repositoryId,
        prototype: { id: prototypeId, name: "Design", branch: "design" },
        buildNumber: 7,
        anchor: {
          schemaVersion: 1,
          kind: "element",
          route: { pathname: "/", search: "", hash: "" },
          selector: "#section",
          accessibleName: "Section",
          tagName: "section",
          selectedText: "",
          rect: { x: 0, y: 0, width: 100, height: 100 },
          viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
          elementOffset: { x: 0, y: 0 },
        },
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
        feedbackDigest: `sha256:${"a".repeat(64)}`,
        resolutionHistory: [],
        outcomeHistory: [],
      },
    ],
  }
}

describe("createReviewCommentLearningSource()", () => {
  it("keeps retained deleted bodies out of the package collection", async () => {
    const value = snapshot()
    value.threads[0]!.root = {
      ...value.threads[0]!.root,
      body: null,
      deletedAt: capturedAt,
    }
    capture.mockResolvedValue(value)
    const source = createReviewCommentLearningSource({} as never, "https://hub.example.com")

    const result = await source.captureCompleteSnapshot({ repositoryId })
    const collection = result.collection as {
      calls: Array<{
        result: { threads: Array<{ body: string | null; deletedAt: string | null }> }
      }>
    }

    expect(collection.calls[0]?.result.threads[0]).toMatchObject({
      body: null,
      deletedAt: capturedAt.toISOString(),
    })
    expect(result.reviewActivitySnapshot).toEqual({
      "77777777-7777-4777-8777-777777777777": 1,
    })
  })

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
