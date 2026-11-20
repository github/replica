import { createHash } from "node:crypto"

import type { RepositoryReviewSnapshot, ReviewMessage } from "../../review-comments/types.ts"

const contentTrust = {
  source: "hub_review_comments",
  untrusted: true,
  treatAs: "data",
  appliesTo: "comment bodies, anchors and user-controlled display metadata",
} as const

function actor(actor: { userId: string; login: string; name: string | null }) {
  return {
    login: actor.login,
    name: actor.name,
    hubUserId: actor.userId,
    avatarUrl: null,
  }
}

function message(
  value: ReviewMessage,
  prototype: RepositoryReviewSnapshot["threads"][number]["prototype"],
) {
  return {
    id: value.id,
    kind: value.rootId === null ? ("root" as const) : ("reply" as const),
    body: value.body,
    author: actor(value.author),
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
    editedAt: value.editedAt?.toISOString() ?? null,
    deletedAt: value.deletedAt?.toISOString() ?? null,
    prototype: {
      id: prototype.id,
      name: prototype.name,
      branch: prototype.branch,
    },
    ...(value.rootId === null ? {} : { rootId: value.rootId }),
  }
}

function digestMessage(value: ReviewMessage) {
  return {
    id: value.id,
    rootId: value.rootId,
    body: value.body,
    author: value.author,
    createdAt: value.createdAt.toISOString(),
    editedAt: value.editedAt?.toISOString() ?? null,
    deletedAt: value.deletedAt?.toISOString() ?? null,
  }
}

function reviewState(snapshot: RepositoryReviewSnapshot) {
  return {
    repository: snapshot.repository,
    threads: snapshot.threads.map((thread) => ({
      id: thread.id,
      repositoryId: thread.repositoryId,
      prototype: thread.prototype,
      buildNumber: thread.buildNumber,
      anchor: thread.anchor,
      activityVersion: thread.activityVersion,
      resolvedAt: thread.resolvedAt?.toISOString() ?? null,
      resolvedBy: thread.resolvedBy,
      root: digestMessage(thread.root),
      replies: thread.replies.map(digestMessage),
      resolutionHistory: thread.resolutionHistory.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        state: event.state,
        actor: event.actor,
        occurredAt: event.occurredAt.toISOString(),
      })),
      outcomeHistory: thread.outcomeHistory.map((outcome) => ({
        ...outcome,
        verifier: outcome.verifier,
        verifiedAt: outcome.verifiedAt.toISOString(),
      })),
    })),
  }
}

export function createHubReviewCollection(snapshot: RepositoryReviewSnapshot, hubOrigin: string) {
  const target = {
    hubOrigin,
    repository: `repositories/${snapshot.repository.id}`,
    repositoryId: snapshot.repository.id,
    scope: "repository",
  }
  const envelope = {
    contentTrust,
    target,
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt.toISOString(),
  }
  const threads = snapshot.threads.map((thread) => ({
    ...message(thread.root, thread.prototype),
    buildNumber: thread.buildNumber,
    anchor: thread.anchor,
    resolvedAt: thread.resolvedAt?.toISOString() ?? null,
    resolvedBy: thread.resolvedBy ? actor(thread.resolvedBy) : null,
    resolutionHistory: thread.resolutionHistory.map((event) => ({
      id: event.id,
      sequence: event.sequence,
      state: event.state === "resolved" ? "resolved" : "unresolved",
      at: event.occurredAt.toISOString(),
      actor: actor(event.actor),
    })),
    outcomeHistory: thread.outcomeHistory.map((outcome) => ({
      id: outcome.id,
      sequence: outcome.sequence,
      outcome: outcome.kind,
      buildNumber: outcome.buildNumber,
      feedbackDigest: outcome.feedbackDigest,
      resolutionEventId: outcome.resolutionEventId,
      verifier: actor(outcome.verifier),
      verifiedAt: outcome.verifiedAt.toISOString(),
      stale: outcome.stale,
      staleReason: outcome.staleReason,
    })),
    activityVersion: thread.activityVersion,
    replies: thread.replies.map((reply) => message(reply, thread.prototype)),
    threadComplete: true,
    repliesHasMore: false,
    repliesNextCursor: null,
  }))
  const collection = {
    kind: "replica.hub-review-collection/v1",
    reviewerIdentity: "stable-user-id",
    calls: [
      {
        action: "list_repository_comments",
        input: {},
        result: {
          ...envelope,
          scanComplete: true,
          threads,
          hasMore: false,
          nextCursor: null,
        },
      },
    ],
  }
  return {
    collection,
    digest: `sha256:${createHash("sha256")
      .update(JSON.stringify(reviewState(snapshot)))
      .digest("hex")}` as const,
  }
}
