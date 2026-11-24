import type { ReviewReply, ReviewRootComment } from "@utils/review-comment/types"

export function reviewRecords(path: string) {
  const root: ReviewRootComment = {
    id: 1,
    kind: "root",
    body: "Could we make the welcome heading clearer?",
    buildNumber: 3,
    buildPath: `${path}?build=3`,
    anchor: {
      schemaVersion: 1,
      kind: "element",
      route: { pathname: "/welcome", search: "?step=2", hash: "#heading" },
      selector: "#heading",
      accessibleName: "Welcome",
      tagName: "h1",
      selectedText: "",
      rect: { x: 120, y: 160, width: 120, height: 40 },
      viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
      elementOffset: { x: 0.5, y: 0.5 },
    },
    createdAt: "2026-11-16T20:00:00.000Z",
    updatedAt: "2026-11-16T20:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    activityVersion: 1,
    viewerLastSeenActivityVersion: 1,
    author: { login: "mona", name: "Mona", avatarUrl: null },
    viewerCanEdit: false,
    viewerCanDelete: false,
    reactions: [],
  }
  const reply: ReviewReply = {
    id: 2,
    kind: "reply",
    rootId: root.id,
    body: "I will try a shorter heading.",
    createdAt: root.createdAt,
    updatedAt: root.updatedAt,
    editedAt: null,
    deletedAt: null,
    author: { login: "octocat", name: "The Octocat", avatarUrl: null },
    viewerCanEdit: true,
    viewerCanDelete: true,
    reactions: [],
  }
  return { root, reply }
}
