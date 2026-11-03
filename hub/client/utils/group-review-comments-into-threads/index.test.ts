import { describe, expect, it } from "vitest"

import type { ReviewComment, ReviewRootComment } from "@utils/review-comment/types"

import { groupReviewCommentsIntoThreads } from "."

const ROOT: ReviewRootComment = {
  id: 1,
  kind: "root",
  buildNumber: 2,
  buildPath: "/repositories/2001/prototypes/1?build=2",
  body: "Root",
  anchor: {
    schemaVersion: 1,
    kind: "element",
    route: { pathname: "/", search: "", hash: "" },
    selector: "#save",
    accessibleName: "Save",
    tagName: "button",
    selectedText: "",
    rect: { x: 20, y: 30, width: 100, height: 32 },
    viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
    elementOffset: { x: 0.5, y: 0.5 },
  },
  createdAt: "2026-09-14T12:00:00Z",
  updatedAt: "2026-09-14T12:00:00Z",
  editedAt: null,
  deletedAt: null,
  resolvedAt: null,
  resolvedBy: null,
  activityVersion: 1,
  viewerLastSeenActivityVersion: 1,
  author: { login: "octocat", name: "The Octocat", avatarUrl: null },
  viewerCanEdit: true,
  viewerCanDelete: true,
  reactions: [],
}

describe("groupReviewCommentsIntoThreads()", () => {
  it("groups flat replies oldest first and orders threads by latest activity", () => {
    const comments: ReviewComment[] = [
      {
        ...ROOT,
        id: 2,
        body: "Other root",
        createdAt: "2026-09-14T14:00:00Z",
      },
      {
        id: 4,
        kind: "reply",
        rootId: 1,
        body: "Later reply",
        createdAt: "2026-09-14T15:00:00Z",
        updatedAt: "2026-09-14T15:00:00Z",
        editedAt: null,
        deletedAt: null,
        author: { login: "mona", name: "Mona Lisa", avatarUrl: null },
        viewerCanEdit: false,
        viewerCanDelete: false,
        reactions: [],
      },
      ROOT,
      {
        id: 3,
        kind: "reply",
        rootId: 1,
        body: "Earlier reply",
        createdAt: "2026-09-14T13:00:00Z",
        updatedAt: "2026-09-14T13:00:00Z",
        editedAt: null,
        deletedAt: null,
        author: { login: "octocat", name: "The Octocat", avatarUrl: null },
        viewerCanEdit: true,
        viewerCanDelete: true,
        reactions: [],
      },
    ]

    const threads = groupReviewCommentsIntoThreads(comments)

    expect(threads.map(({ root }) => root.id)).toEqual([1, 2])
    expect(threads[0]?.replies.map(({ id }) => id)).toEqual([3, 4])
    expect(threads[0]?.participants.map(({ login }) => login)).toEqual(["octocat", "mona"])
    expect(threads.every(({ unread }) => !unread)).toBe(true)
  })

  it("keeps a deleted root only while live replies remain", () => {
    const deletedRoot: ReviewRootComment = {
      ...ROOT,
      body: null,
      deletedAt: "2026-09-14T13:00:00Z",
      viewerCanEdit: false,
      viewerCanDelete: false,
    }
    const reply: ReviewComment = {
      id: 2,
      kind: "reply",
      rootId: 1,
      body: "Reply",
      createdAt: "2026-09-14T14:00:00Z",
      updatedAt: "2026-09-14T14:00:00Z",
      editedAt: null,
      deletedAt: null,
      author: { login: "mona", name: "Mona Lisa", avatarUrl: null },
      viewerCanEdit: false,
      viewerCanDelete: false,
      reactions: [],
    }

    expect(groupReviewCommentsIntoThreads([deletedRoot])).toEqual([])
    expect(groupReviewCommentsIntoThreads([reply, deletedRoot])).toHaveLength(1)
    expect(
      groupReviewCommentsIntoThreads([
        { ...reply, body: null, deletedAt: "2026-09-14T15:00:00Z" },
        deletedRoot,
      ]),
    ).toEqual([])
  })

  it("marks a thread unread when the reviewer has not seen its root activity", () => {
    const [thread] = groupReviewCommentsIntoThreads([
      { ...ROOT, activityVersion: 2, viewerLastSeenActivityVersion: 1 },
    ])

    expect(thread?.unread).toBe(true)
  })
})
