import { z } from "zod"

import type { ReviewAnchor } from "@utils/review-anchor/types"
import type {
  ReviewComment,
  ReviewReactionContent,
  ReviewRootComment,
} from "@utils/review-comment/types"
import { REVIEW_COMMENT_SCHEMA } from "@utils/review-comment/schemas"

import type { MockFlowContext } from "../flow-context/types"
import { MockStoreError } from "../store-error"
import seed from "../review-seed.json"

const seedSchema = z.array(
  z.object({
    repositoryId: z.number().int().positive(),
    prototypeId: z.number().int().positive(),
    buildNumber: z.number().int().positive(),
    authorLogin: z.string().min(1),
    body: z.string().min(1),
    reply: z.string().min(1),
  }),
)

export function createReviewStore(context: MockFlowContext) {
  const collections = new Map<string, ReviewComment[]>()
  const readVersions = new Map<string, number>()
  const reactions = new Map<number, Map<ReviewReactionContent, Set<string>>>()
  let nextId = 1

  function author(login: string) {
    const user = context.resources.users.find((item) => item.login === login)
    if (!user) throw new Error("A mock review refers to an unknown user.")
    return { login: user.login, name: user.name, avatarUrl: user.avatarUrl }
  }

  function common(login: string, body: string) {
    const now = new Date().toISOString()
    return {
      id: nextId++,
      body,
      createdAt: now,
      updatedAt: now,
      editedAt: null,
      deletedAt: null,
      author: author(login),
      viewerCanEdit: false,
      viewerCanDelete: false,
      reactions: [],
    }
  }

  for (const item of seedSchema.parse(seed)) {
    if (
      !context.resources.builds.some(
        (build) =>
          build.repositoryId === item.repositoryId &&
          build.prototypeId === item.prototypeId &&
          build.number === item.buildNumber &&
          build.previewUrl,
      )
    ) {
      continue
    }
    const response = context.prototypeResponse(
      item.repositoryId,
      item.prototypeId,
      item.buildNumber,
    )
    const preview = response.selectedBuild?.previewUrl
    if (!preview) throw new Error("A seeded mock review requires a preview build.")
    const url = new URL(preview)
    const root: ReviewRootComment = {
      ...common(item.authorLogin, item.body),
      kind: "root",
      buildNumber: item.buildNumber,
      buildPath: `/repositories/${item.repositoryId}/prototypes/${item.prototypeId}?build=${item.buildNumber}`,
      anchor: {
        schemaVersion: 1,
        kind: "element",
        route: { pathname: url.pathname, search: url.search, hash: "" },
        selector: "#name",
        accessibleName: "",
        tagName: "h1",
        selectedText: "Welcome",
        rect: { x: 100, y: 180, width: 400, height: 80 },
        viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
        elementOffset: { x: 0.5, y: 0.5 },
      },
      resolvedAt: null,
      resolvedBy: null,
      activityVersion: 1,
      viewerLastSeenActivityVersion: null,
    }
    const reply: ReviewComment = {
      ...common("octocat", item.reply),
      kind: "reply",
      rootId: root.id,
    }
    collections.set(`${item.repositoryId}/${item.prototypeId}`, [
      REVIEW_COMMENT_SCHEMA.parse(root),
      REVIEW_COMMENT_SCHEMA.parse(reply),
    ])
  }

  function collection(repositoryId: number, prototypeId: number) {
    context.session.requireViewer()
    context.prototypeResponse(repositoryId, prototypeId)
    const key = `${repositoryId}/${prototypeId}`
    let records = collections.get(key)
    if (!records) {
      records = []
      collections.set(key, records)
    }
    return records
  }

  function writable() {
    const viewer = context.session.requireViewer()
    if (context.session.read().profile === "reader") {
      throw new MockStoreError(403, "This mock profile can read reviews but cannot change them.")
    }
    return viewer
  }

  function present(comment: ReviewComment): ReviewComment {
    const viewer = context.session.requireViewer()
    const canChange =
      context.session.read().profile !== "reader" &&
      comment.author.login === viewer.login &&
      !comment.deletedAt
    return REVIEW_COMMENT_SCHEMA.parse({
      ...structuredClone(comment),
      viewerCanEdit: canChange,
      viewerCanDelete: canChange,
      reactions: [...(reactions.get(comment.id) ?? [])]
        .filter(([, logins]) => logins.size > 0)
        .map(([content, logins]) => ({
          content,
          count: logins.size,
          viewerHasReacted: logins.has(viewer.login),
        })),
      ...(comment.kind === "root"
        ? {
            viewerLastSeenActivityVersion:
              readVersions.get(`${viewer.login}/${comment.id}`) ?? null,
          }
        : {}),
    })
  }

  function find(repositoryId: number, prototypeId: number, commentId: number) {
    const records = collection(repositoryId, prototypeId)
    const comment = records.find(({ id }) => id === commentId)
    if (!comment) throw new MockStoreError(404, "Review comment not found.")
    const root =
      comment.kind === "root"
        ? comment
        : records.find((item) => item.kind === "root" && item.id === comment.rootId)
    if (!root || root.kind !== "root") throw new Error("A mock reply has no root comment.")
    return { records, comment, root }
  }

  function changed(root: ReviewRootComment, comment: ReviewComment = root) {
    root.activityVersion += 1
    root.updatedAt = new Date().toISOString()
    const viewer = context.session.requireViewer()
    readVersions.set(`${viewer.login}/${root.id}`, root.activityVersion)
    return {
      comments: comment === root ? [present(root)] : [present(comment), present(root)],
    }
  }

  return {
    list(repositoryId: number, prototypeId: number) {
      return {
        comments: collection(repositoryId, prototypeId).map(present),
        nextCursor: null,
        hasMore: false as const,
      }
    },
    create(
      repositoryId: number,
      prototypeId: number,
      buildNumber: number,
      body: string,
      anchor: ReviewAnchor,
    ) {
      const viewer = writable()
      const build = context.prototypeResponse(repositoryId, prototypeId, buildNumber)
      if (!build.selectedBuild?.previewUrl) {
        throw new MockStoreError(409, "Choose a build with a preview before adding a review.")
      }
      const root: ReviewRootComment = {
        ...common(viewer.login, body),
        kind: "root",
        buildNumber,
        buildPath: `/repositories/${repositoryId}/prototypes/${prototypeId}?build=${buildNumber}`,
        anchor,
        resolvedAt: null,
        resolvedBy: null,
        activityVersion: 1,
        viewerLastSeenActivityVersion: 1,
      }
      collection(repositoryId, prototypeId).push(root)
      readVersions.set(`${viewer.login}/${root.id}`, 1)
      return { comments: [present(root)] }
    },
    reply(repositoryId: number, prototypeId: number, rootId: number, body: string) {
      const viewer = writable()
      const { records, comment, root } = find(repositoryId, prototypeId, rootId)
      if (comment.kind !== "root" || root.resolvedAt || root.deletedAt) {
        throw new MockStoreError(409, "This conversation cannot receive replies.")
      }
      const reply: ReviewComment = { ...common(viewer.login, body), kind: "reply", rootId }
      records.push(reply)
      return changed(root, reply)
    },
    edit(repositoryId: number, prototypeId: number, commentId: number, body: string | null) {
      const viewer = writable()
      const { comment, root } = find(repositoryId, prototypeId, commentId)
      if (comment.author.login !== viewer.login || comment.deletedAt) {
        throw new MockStoreError(403, "You cannot change this mock comment.")
      }
      comment.body = body
      comment.updatedAt = new Date().toISOString()
      if (body === null) comment.deletedAt = comment.updatedAt
      else comment.editedAt = comment.updatedAt
      return changed(root, comment)
    },
    resolve(repositoryId: number, prototypeId: number, rootId: number, resolved: boolean) {
      const viewer = writable()
      const { comment, root } = find(repositoryId, prototypeId, rootId)
      if (comment.kind !== "root" || root.deletedAt) {
        throw new MockStoreError(409, "This conversation cannot change resolution.")
      }
      root.resolvedAt = resolved ? new Date().toISOString() : null
      root.resolvedBy = resolved ? author(viewer.login) : null
      return changed(root)
    },
    react(
      repositoryId: number,
      prototypeId: number,
      commentId: number,
      content: ReviewReactionContent,
      version: number,
      add: boolean,
    ) {
      const viewer = writable()
      const { comment, root } = find(repositoryId, prototypeId, commentId)
      if (comment.deletedAt || version !== root.activityVersion) {
        throw new MockStoreError(409, "This conversation changed. Reload it before reacting.")
      }
      const contents = reactions.get(commentId) ?? new Map<ReviewReactionContent, Set<string>>()
      const logins = contents.get(content) ?? new Set<string>()
      if (add) logins.add(viewer.login)
      else logins.delete(viewer.login)
      contents.set(content, logins)
      reactions.set(commentId, contents)
      return changed(root, comment)
    },
    markRead(repositoryId: number, prototypeId: number, rootId: number, version: number | null) {
      const viewer = context.session.requireViewer()
      const { comment, root } = find(repositoryId, prototypeId, rootId)
      if (comment.kind !== "root") throw new MockStoreError(400, "Choose a root conversation.")
      if (version !== null && version > root.activityVersion) {
        throw new MockStoreError(409, "The read position is ahead of this conversation.")
      }
      const key = `${viewer.login}/${rootId}`
      if (version === null) readVersions.delete(key)
      else readVersions.set(key, Math.max(readVersions.get(key) ?? 0, version))
      return { comments: [present(root)] }
    },
  }
}

export type ReviewMockStore = ReturnType<typeof createReviewStore>
