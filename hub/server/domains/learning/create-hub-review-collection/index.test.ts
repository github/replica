import { describe, expect, it } from "vitest"

import type { RepositoryReviewSnapshot } from "../../review-comments/types"
import { createHubReviewCollection } from "."

const repositoryId = "11111111-2222-4333-8444-555555555555"
const repositoryScope = "github.com/repositories/123"
const prototypeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const author = {
  userId: "22222222-2222-4222-8222-222222222222",
  login: "mona",
  name: "Mona",
}

function snapshot(): RepositoryReviewSnapshot {
  const createdAt = new Date("2026-11-13T10:00:00Z")
  return {
    snapshotId: "33333333-3333-4333-8333-333333333333",
    capturedAt: new Date("2026-11-13T10:05:00Z"),
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
        activityVersion: 4,
        createdAt,
        updatedAt: createdAt,
        resolvedAt: new Date("2026-11-13T10:04:00Z"),
        resolvedBy: author,
        root: {
          id: 101,
          storageId: "44444444-4444-4444-8444-444444444444",
          rootId: null,
          body: "Please align this section.",
          author,
          createdAt,
          updatedAt: createdAt,
          editedAt: null,
          deletedAt: null,
        },
        replies: [
          {
            id: 102,
            storageId: "55555555-5555-4555-8555-555555555555",
            rootId: 101,
            body: null,
            author,
            createdAt,
            updatedAt: createdAt,
            editedAt: null,
            deletedAt: new Date("2026-11-13T10:03:00Z"),
          },
        ],
        resolutionHistory: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            sequence: 1,
            state: "resolved" as const,
            actor: author,
            occurredAt: new Date("2026-11-13T10:04:00Z"),
          },
        ],
      },
    ],
  }
}

describe("createHubReviewCollection()", () => {
  it("writes a complete v1 log with UUID identities, deleted comments, and resolution history", () => {
    const result = createHubReviewCollection(snapshot(), "https://hub.example.com", repositoryScope)
    const call = result.collection.calls[0]
    if (!call) throw new Error("Expected one collection call.")
    const thread = call.result.threads[0]
    if (!thread) throw new Error("Expected one review thread.")

    expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.collection.reviewerIdentity).toBe("stable-user-id")
    expect(call.result.target).toMatchObject({
      repository: `repositories/${repositoryId}`,
      repositoryId,
      scope: "repository",
    })
    expect(thread.author).toMatchObject({
      hubUserId: author.userId,
      avatarUrl: null,
    })
    expect(thread.replies[0]).toMatchObject({
      id: 102,
      body: null,
      deletedAt: "2026-11-13T10:03:00.000Z",
    })
    expect(thread.resolutionHistory).toEqual([
      {
        id: "66666666-6666-4666-8666-666666666666",
        sequence: 1,
        state: "resolved",
        at: "2026-11-13T10:04:00.000Z",
        actor: {
          login: "mona",
          name: "Mona",
          hubUserId: author.userId,
          avatarUrl: null,
        },
      },
    ])
    expect(thread.threadComplete).toBe(true)
    expect(thread.repliesHasMore).toBe(false)

    const laterCapture = snapshot()
    laterCapture.snapshotId = "88888888-8888-4888-8888-888888888888"
    laterCapture.capturedAt = new Date("2026-11-13T10:06:00Z")
    laterCapture.threads[0]!.updatedAt = new Date("2026-11-13T10:06:00Z")
    laterCapture.threads[0]!.root.updatedAt = new Date("2026-11-13T10:06:00Z")
    expect(
      createHubReviewCollection(laterCapture, "https://hub.example.com", repositoryScope).digest,
    ).toBe(result.digest)
    const otherScope = createHubReviewCollection(
      laterCapture,
      "https://hub.example.com",
      "github.com/repositories/456",
    )
    expect(otherScope.digest).not.toBe(result.digest)
    expect(otherScope.legacyDigest).toBe(result.legacyDigest)
  })
})
