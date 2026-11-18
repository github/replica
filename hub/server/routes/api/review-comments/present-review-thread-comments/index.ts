import type {
  ReviewActor,
  ReviewMessage,
  ReviewThread,
} from "../../../../domains/review-comments/types.ts"

function presentActor(actor: ReviewActor) {
  return {
    userId: actor.userId,
    login: actor.login,
    name: actor.name,
    avatarUrl: null,
  }
}

function presentMessage(message: ReviewMessage, viewerId: string) {
  return {
    id: message.id,
    body: message.body,
    mentions: [],
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    author: presentActor(message.author),
    viewerCanEdit: message.author.userId === viewerId && message.deletedAt === null,
    viewerCanDelete: message.author.userId === viewerId && message.deletedAt === null,
    reactions: [],
  }
}

export function presentReviewThreadComments(thread: ReviewThread, viewerId: string) {
  return [
    {
      ...presentMessage(thread.root, viewerId),
      kind: "root" as const,
      buildNumber: thread.buildNumber,
      buildPath: `/repositories/${thread.repositoryId}/prototypes/${thread.prototype.id}?build=${thread.buildNumber}`,
      anchor: thread.anchor,
      resolvedAt: thread.resolvedAt,
      resolvedBy: thread.resolvedBy ? presentActor(thread.resolvedBy) : null,
      resolutionHistory: thread.resolutionHistory.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        state: event.state,
        actor: presentActor(event.actor),
        occurredAt: event.occurredAt,
      })),
      activityVersion: thread.activityVersion,
      viewerLastSeenActivityVersion: thread.activityVersion,
    },
    ...thread.replies.map((reply) => ({
      ...presentMessage(reply, viewerId),
      kind: "reply" as const,
      rootId: thread.id,
    })),
  ]
}
