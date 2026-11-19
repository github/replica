import type { Prisma } from "../../../generated/prisma/client.ts"
import {
  findAnalyticsReviewBuild,
  isAnalyticsPrototype,
  persistAnalyticsEvent,
  setFirstPublishedAt,
} from "../../../repositories/analytics/event-store/index.ts"
import { lockAnalyticsRepository } from "../../../repositories/analytics/lock-repository/index.ts"

interface PrototypeActivity {
  repositoryId: string
  prototypeId: string
}

interface BuildActivity extends PrototypeActivity {
  buildId: string
}

interface ReviewActivity extends BuildActivity {
  threadId: string
}

type AnalyticsActivity =
  | (PrototypeActivity & { eventName: "prototype_registered" })
  | (BuildActivity & { eventName: "prototype_first_published" | "build_published" })
  | (ReviewActivity & {
      eventName: "review_comment_created" | "review_reply_added"
      commentId: string
    })
  | (ReviewActivity & {
      eventName: "review_thread_resolved" | "review_thread_reopened"
      transitionId: string
    })

/** Call inside the transaction that creates the corresponding product transition. */
export async function recordAnalyticsEvent(tx: Prisma.TransactionClient, input: AnalyticsActivity) {
  const { repositoryId, prototypeId, eventName } = input
  let sourceKey: string
  switch (input.eventName) {
    case "prototype_registered":
      sourceKey = `registration/${prototypeId}`
      break
    case "prototype_first_published":
    case "build_published":
      sourceKey = `publication/${input.buildId}`
      break
    case "review_comment_created":
    case "review_reply_added":
      sourceKey = `comment/${input.commentId}`
      break
    case "review_thread_resolved":
    case "review_thread_reopened":
      sourceKey = `resolution/${input.transitionId}`
      break
    default:
      throw new Error("Unsupported repository analytics fact.")
  }
  await lockAnalyticsRepository(tx, repositoryId)
  return persistAnalyticsEvent(tx, {
    repositoryId,
    prototypeId,
    eventName,
    sourceKey,
    occurredAt: new Date(),
    buildId: "buildId" in input ? input.buildId : undefined,
    threadId: "threadId" in input ? input.threadId : undefined,
    commentId: "commentId" in input ? input.commentId : undefined,
  })
}

/** Call only when storing a successful Build, not when observing a workflow conclusion. */
export async function recordSuccessfulBuildAnalytics(
  tx: Prisma.TransactionClient,
  input: BuildActivity,
) {
  if (!(await isAnalyticsPrototype(tx, input.repositoryId, input.prototypeId))) return
  const first = await setFirstPublishedAt(tx, input.repositoryId, input.prototypeId, new Date())
  return recordAnalyticsEvent(tx, {
    ...input,
    eventName: first ? "prototype_first_published" : "build_published",
  })
}

/** Bridges the review activity callback without passing author data or a review body. */
export async function recordReviewAnalyticsActivity(
  tx: Prisma.TransactionClient,
  {
    repositoryId,
    prototypeId,
    threadId,
    kind,
    sourceId,
  }: PrototypeActivity & {
    threadId: string
    kind: "comment" | "reply" | "resolved" | "reopened"
    sourceId: string
  },
) {
  const { buildId } = await findAnalyticsReviewBuild(tx, repositoryId, prototypeId, threadId)
  const context = { repositoryId, prototypeId, buildId, threadId }
  if (kind === "comment" || kind === "reply") {
    return recordAnalyticsEvent(tx, {
      ...context,
      commentId: sourceId,
      eventName: kind === "comment" ? "review_comment_created" : "review_reply_added",
    })
  }
  return recordAnalyticsEvent(tx, {
    ...context,
    transitionId: sourceId,
    eventName: kind === "resolved" ? "review_thread_resolved" : "review_thread_reopened",
  })
}
