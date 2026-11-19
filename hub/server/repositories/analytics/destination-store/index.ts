import type {
  AnalyticsDestination,
  AnalyticsEventName,
  Prisma,
} from "../../../generated/prisma/client.ts"

export async function listAnalyticsDestinations(
  tx: Prisma.TransactionClient,
  repositoryId: string,
) {
  return tx.analyticsDestination.findMany({
    where: { repositoryId, repository: { removedAt: null } },
    include: {
      deliveries: {
        where: { state: { in: ["failed", "retryable"] } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { destinationRevision: true },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })
}

export async function loadAnalyticsDestination(
  tx: Prisma.TransactionClient,
  repositoryId: string,
  destinationId: string,
) {
  return tx.analyticsDestination.findUnique({
    where: { id_repositoryId: { id: destinationId, repositoryId } },
  })
}

export async function updateAnalyticsBacklog(
  tx: Prisma.TransactionClient,
  destination: AnalyticsDestination,
  changedRecipient: boolean,
  keepPending: boolean,
) {
  const active = {
    destinationId: destination.id,
    state: { in: ["pending", "retryable", "delivering"] },
  } satisfies Prisma.AnalyticsDeliveryWhereInput

  if (changedRecipient && keepPending) {
    await tx.analyticsDelivery.updateMany({
      where: { ...active, state: { in: ["pending", "retryable"] } },
      data: { destinationRevision: destination.revision },
    })
  }
  await tx.analyticsDelivery.updateMany({
    where: {
      ...active,
      OR: [
        { event: { eventName: { notIn: destination.eventTypes } } },
        ...(changedRecipient ? [{ destinationRevision: { not: destination.revision } }] : []),
      ],
    },
    data: { state: "canceled", leaseId: null, enqueueClaimExpiresAt: null, failureCode: null },
  })
}

export async function readBackfillCandidates(
  tx: Prisma.TransactionClient,
  repositoryId: string,
  eventTypes: AnalyticsEventName[],
  cutoff: Date,
  limit: number,
) {
  return tx.analyticsEvent.findMany({
    where: { repositoryId, eventName: { in: eventTypes }, occurredAt: { gte: cutoff } },
    select: { id: true },
    take: limit,
  })
}

export async function queueRetainedAnalyticsEvents(
  tx: Prisma.TransactionClient,
  destination: AnalyticsDestination,
  events: { id: string }[],
  now: Date,
) {
  if (!events.length) return
  await tx.analyticsDelivery.createMany({
    data: events.map((event) => ({
      repositoryId: destination.repositoryId,
      destinationId: destination.id,
      destinationRevision: destination.revision,
      eventId: event.id,
      dueAt: now,
    })),
    skipDuplicates: true,
  })
}
