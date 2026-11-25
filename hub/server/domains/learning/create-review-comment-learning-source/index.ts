import type { PrismaClient } from "../../../generated/prisma/client.ts"
import { captureRepositoryReviewSnapshot } from "../../review-comments/capture-repository-review-snapshot/index.ts"
import { createHubReviewCollection } from "../create-hub-review-collection/index.ts"
import { getLearningRepositoryScope } from "../get-learning-repository-scope/index.ts"
import type {
  LearningObservationEvent,
  ReviewCommentLearningSource,
} from "../review-comment-learning-source/types.ts"

function eventMap(events: LearningObservationEvent[]) {
  return new Map(events.map((event) => [event.id, event]))
}

export function createReviewCommentLearningSource(
  database: Pick<PrismaClient, "$transaction" | "repository">,
  hubOrigin: string,
): ReviewCommentLearningSource {
  return {
    async captureCompleteSnapshot({ repositoryId }) {
      const repositoryScope = await getLearningRepositoryScope(database, repositoryId)
      const snapshot = await captureRepositoryReviewSnapshot(database, repositoryId)
      if (repositoryScope !== (await getLearningRepositoryScope(database, repositoryId))) {
        throw new Error("The repository learning scope changed during review capture.")
      }
      const { collection, digest, legacyDigest } = createHubReviewCollection(
        snapshot,
        hubOrigin,
        repositoryScope,
      )
      return {
        collection,
        digest,
        legacyDigest,
        repositoryScope,
        capturedAt: snapshot.capturedAt,
        reviewActivitySnapshot: Object.fromEntries(
          snapshot.threads.map((thread) => [thread.storageId, thread.activityVersion]),
        ),
      }
    },
    async resolveEvidence({ repositoryId, references, events }) {
      const snapshot = await captureRepositoryReviewSnapshot(database, repositoryId)
      const comments = new Map(
        snapshot.threads.flatMap((thread) =>
          [thread.root, ...thread.replies].map(
            (comment) => [comment.id, { comment, thread }] as const,
          ),
        ),
      )
      const observations = eventMap(events)
      return references.map((reference, referenceIndex) => {
        if (
          reference.source.kind !== "hub_review_comments" ||
          reference.source.hubOrigin !== hubOrigin ||
          reference.source.repositoryId !== repositoryId ||
          reference.source.commentId === undefined
        ) {
          return { referenceIndex, evidence: [] }
        }
        const stored = comments.get(reference.source.commentId)
        if (!stored) return { referenceIndex, evidence: [] }
        if (
          (reference.source.prototypeId !== undefined &&
            reference.source.prototypeId !== stored.thread.prototype.id) ||
          (reference.source.threadId !== undefined &&
            reference.source.threadId !== stored.thread.id)
        ) {
          return { referenceIndex, evidence: [] }
        }
        const evidence = reference.eventIds.flatMap((eventId) => {
          const event = observations.get(eventId)
          if (
            !event ||
            event.episodeId !== reference.episodeId ||
            event.payload.commentId !== stored.comment.id
          ) {
            return []
          }
          return [
            {
              eventId,
              commentId: stored.comment.id,
              body: stored.comment.deletedAt ? null : event.payload.body,
              authorLogin: stored.comment.author.login,
              authorAvatarUrl: null,
              prototypeId: stored.thread.prototype.id,
              prototypeName: stored.thread.prototype.name ?? stored.thread.prototype.branch,
              createdAt: (stored.comment.deletedAt
                ? stored.comment.createdAt
                : new Date(event.at)
              ).toISOString(),
            },
          ]
        })
        return { referenceIndex, evidence }
      })
    },
  }
}
