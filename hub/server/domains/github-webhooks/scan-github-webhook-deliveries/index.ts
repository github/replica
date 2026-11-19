import { listClaimedGitHubWebhookDeliveries } from "../../../repositories/github-webhook-deliveries/list-claimed-github-webhook-deliveries/index.ts"
import { createGitHubWebhookRedeliveries } from "../../../repositories/github-webhook-redeliveries/create-github-webhook-redeliveries/index.ts"
import {
  recoverableWebhookEvents,
  webhookRecoveryPagesPerRun,
  webhookRedeliveryWindowMs,
  webhookScanOverlapMs,
} from "../constants.ts"
import type { GitHubWebhookRecoveryDependencies, GitHubWebhookRecoveryLease } from "../types.ts"

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function transient(statusCode: number) {
  return statusCode === 0 || statusCode === 429 || statusCode >= 500
}

/**
 * Pages through the App's recent deliveries, newest first, from the saved cursor.
 * Records each missed delivery that GitHub can still redeliver and returns the
 * delivery IDs that reached the Hub. A scan ends at the previous scan's start or
 * the redelivery window, then the next run starts again from the newest delivery.
 */
export async function scanGitHubWebhookDeliveries(
  { database, installationId, listDeliveries, logger, now }: GitHubWebhookRecoveryDependencies,
  lease: GitHubWebhookRecoveryLease,
  checkpoint: {
    cursor: string | null
    lastCompletedScanStartedAt: Date | null
    scanStartedAt: Date | null
  },
): Promise<string[]> {
  let { cursor } = checkpoint
  const scanStartedAt = (cursor && checkpoint.scanStartedAt) || now()
  const windowStart = new Date(scanStartedAt.getTime() - webhookRedeliveryWindowMs)
  const { lastCompletedScanStartedAt } = checkpoint
  if (!cursor && lastCompletedScanStartedAt && lastCompletedScanStartedAt < windowStart) {
    logger.error(
      { lastCompletedScanStartedAt },
      "GitHub webhook recovery fell behind; some missed deliveries can no longer be redelivered",
    )
  }
  const boundary = new Date(
    Math.max(
      windowStart.getTime(),
      (lastCompletedScanStartedAt?.getTime() ?? 0) - webhookScanOverlapMs,
    ),
  )
  const delivered = new Set<string>()

  for (let page = 0; page < webhookRecoveryPagesPerRun; page += 1) {
    const { deliveries, nextCursor } = await listDeliveries(cursor)
    const relevant = deliveries.filter(
      (delivery) =>
        String(delivery.installationId) === installationId &&
        recoverableWebhookEvents.has(delivery.event) &&
        uuid.test(delivery.guid),
    )
    for (const delivery of relevant) {
      if (delivery.statusCode >= 200 && delivery.statusCode < 300) delivered.add(delivery.guid)
    }
    const missed = relevant.filter(
      (delivery) =>
        transient(delivery.statusCode) &&
        !delivered.has(delivery.guid) &&
        delivery.deliveredAt.getTime() + webhookRedeliveryWindowMs > now().getTime(),
    )
    const received = await listClaimedGitHubWebhookDeliveries(
      database,
      missed.map((delivery) => delivery.guid),
    )
    await createGitHubWebhookRedeliveries(
      database,
      missed
        .filter((delivery) => !received.has(delivery.guid))
        .map((delivery) => ({
          event: delivery.event,
          expiresAt: new Date(delivery.deliveredAt.getTime() + webhookRedeliveryWindowMs),
          githubDeliveryId: delivery.id,
          id: delivery.guid,
          retryAt: now(),
        })),
    )

    const finished =
      !nextCursor ||
      (deliveries.length > 0 && deliveries.every((delivery) => delivery.deliveredAt < boundary))
    cursor = finished ? null : nextCursor
    const renewed = await lease.renew(
      finished
        ? { cursor: null, lastCompletedScanStartedAt: scanStartedAt, scanStartedAt: null }
        : { cursor, scanStartedAt },
    )
    if (!renewed || finished) break
  }
  return [...delivered]
}
