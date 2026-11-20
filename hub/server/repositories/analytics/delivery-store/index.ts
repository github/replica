import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts"

function eligible(now: Date, cutoff: Date) {
  return Prisma.sql`
    SELECT delivery.id
    FROM analytics_deliveries AS delivery
    JOIN analytics_destinations AS destination ON destination.id = delivery.destination_id
    JOIN analytics_events AS event ON event.id = delivery.event_id
    JOIN repositories AS repository ON repository.id = delivery.repository_id
    WHERE delivery.state IN ('pending', 'retryable', 'delivering')
      AND delivery.due_at <= ${now}
      AND destination.enabled
      AND delivery.destination_revision = destination.revision
      AND event.event_name = ANY(destination.event_types)
      AND event.occurred_at >= ${cutoff}
      AND repository.removed_at IS NULL
  `
}

export function claimAnalyticsEnqueues(
  database: PrismaClient,
  now: Date,
  cutoff: Date,
  until: Date,
) {
  return database.$queryRaw<{ id: string }[]>`
    WITH eligible AS (
      ${eligible(now, cutoff)}
      AND (delivery.enqueue_claim_expires_at IS NULL OR delivery.enqueue_claim_expires_at <= ${now})
      ORDER BY delivery.due_at, delivery.id
      LIMIT 100
      FOR UPDATE OF delivery SKIP LOCKED
    )
    UPDATE analytics_deliveries AS delivery
    SET enqueue_claim_expires_at = ${until}, updated_at = ${now}
    FROM eligible WHERE delivery.id = eligible.id
    RETURNING delivery.id
  `
}

export async function releaseAnalyticsEnqueue(
  database: PrismaClient,
  id: string,
  claimedUntil: Date,
) {
  await database.analyticsDelivery.updateMany({
    where: { id, enqueueClaimExpiresAt: claimedUntil },
    data: { enqueueClaimExpiresAt: null },
  })
}

export async function claimAnalyticsDelivery(
  database: PrismaClient,
  id: string,
  leaseId: string,
  now: Date,
  cutoff: Date,
  leaseUntil: Date,
  maximumAttempts: number,
) {
  const rows = await database.$queryRaw<{ attempts: number; leaseId: string | null }[]>`
    WITH eligible AS (
      ${eligible(now, cutoff)}
      AND delivery.id = ${id}::uuid
      FOR UPDATE OF delivery SKIP LOCKED
    )
    UPDATE analytics_deliveries AS delivery
    SET lease_id = CASE WHEN attempts < ${maximumAttempts} THEN ${leaseId}::uuid ELSE NULL END,
        state = (CASE WHEN attempts < ${maximumAttempts} THEN 'delivering' ELSE 'failed' END)::"AnalyticsDeliveryState",
        failure_code = CASE WHEN attempts < ${maximumAttempts} THEN failure_code ELSE 'attempts_exhausted' END,
        attempts = LEAST(attempts + 1, ${maximumAttempts}),
        due_at = ${leaseUntil},
        enqueue_claim_expires_at = NULL,
        updated_at = ${now}
    FROM eligible WHERE delivery.id = eligible.id
    RETURNING delivery.attempts, delivery.lease_id AS "leaseId"
  `
  return rows[0]?.leaseId ? rows[0].attempts : null
}

export function readClaimedAnalyticsDelivery(
  database: PrismaClient,
  id: string,
  leaseId: string,
  cutoff: Date,
) {
  return database.analyticsDelivery.findFirst({
    where: {
      id,
      leaseId,
      state: "delivering",
      destination: { enabled: true, repository: { removedAt: null } },
      event: { occurredAt: { gte: cutoff } },
    },
    include: { event: true, destination: true },
  })
}

export function finishAnalyticsDelivery(
  database: PrismaClient,
  id: string,
  leaseId: string,
  data: Prisma.AnalyticsDeliveryUpdateManyMutationInput,
) {
  return database.analyticsDelivery.updateMany({
    where: { id, leaseId, state: "delivering" },
    data: { ...data, leaseId: null },
  })
}

export async function removeExpiredAnalyticsEvents(database: PrismaClient, cutoff: Date) {
  return database.$executeRaw`
    DELETE FROM analytics_events
    WHERE id IN (SELECT id FROM analytics_events WHERE occurred_at < ${cutoff} ORDER BY occurred_at, id LIMIT 5000)
  `
}
