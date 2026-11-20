import type { Prisma } from "../../generated/prisma/client.ts"

export const reviewThreadInclude = {
  prototype: { select: { id: true, name: true, branchName: true } },
  build: { select: { number: true } },
  comments: { orderBy: { publicId: "asc" } },
  resolutionEvents: { orderBy: { sequence: "asc" } },
  outcomes: {
    include: { build: { select: { number: true, state: true } } },
    orderBy: { sequence: "asc" },
  },
} satisfies Prisma.ReviewThreadInclude

export type StoredReviewThread = Prisma.ReviewThreadGetPayload<{
  include: typeof reviewThreadInclude
}>

export type ReviewPersistenceFailure =
  | "comment_deleted"
  | "comment_forbidden"
  | "comment_not_found"
  | "conflict"
  | "repository_not_found"
  | "session_invalid"
  | "thread_closed"
  | "thread_deleted"
  | "thread_not_found"
  | "build_not_found"
  | "feedback_changed"
  | "resolution_changed"
  | "thread_unresolved"
  | "prototype_not_found"

export type ReviewPersistenceResult<T> =
  { ok: true; value: T } | { ok: false; reason: ReviewPersistenceFailure }
