import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function persistAnalyticsEvent(
  tx: Prisma.TransactionClient,
  event: Omit<Prisma.AnalyticsEventCreateManyInput, "id">,
) {
  const id = randomUUID()
  const result = await tx.analyticsEvent.createMany({
    data: { id, ...event },
    skipDuplicates: true,
  })
  if (!result.count) {
    return tx.analyticsEvent.findUniqueOrThrow({
      where: {
        repositoryId_sourceKey: { repositoryId: event.repositoryId, sourceKey: event.sourceKey },
      },
      select: { id: true },
    })
  }
  const destinations = await tx.analyticsDestination.findMany({
    where: { repositoryId: event.repositoryId, eventTypes: { has: event.eventName } },
    select: { id: true, revision: true },
  })
  if (destinations.length > 0) {
    await tx.analyticsDelivery.createMany({
      data: destinations.map((destination) => ({
        repositoryId: event.repositoryId,
        eventId: id,
        destinationId: destination.id,
        destinationRevision: destination.revision,
        dueAt: event.occurredAt,
      })),
    })
  }
  return { id }
}

export async function setFirstPublishedAt(
  tx: Prisma.TransactionClient,
  repositoryId: string,
  prototypeId: string,
  now: Date,
) {
  const result = await tx.prototype.updateMany({
    where: { id: prototypeId, repositoryId, firstPublishedAt: null },
    data: { firstPublishedAt: now },
  })
  return result.count > 0
}

export function findAnalyticsReviewBuild(
  tx: Prisma.TransactionClient,
  repositoryId: string,
  prototypeId: string,
  threadId: string,
) {
  return tx.reviewThread.findFirstOrThrow({
    where: { id: threadId, repositoryId, prototypeId },
    select: { buildId: true },
  })
}
