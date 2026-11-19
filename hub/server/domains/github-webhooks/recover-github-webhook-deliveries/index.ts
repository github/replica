import { randomUUID } from "node:crypto"

import { deleteSettledGitHubWebhookRedeliveries } from "../../../repositories/github-webhook-redeliveries/delete-settled-github-webhook-redeliveries/index.ts"
import { claimGitHubWebhookRecoveryCheckpoint } from "../../../repositories/github-webhook-recovery-checkpoints/claim-github-webhook-recovery-checkpoint/index.ts"
import { updateGitHubWebhookRecoveryCheckpoint } from "../../../repositories/github-webhook-recovery-checkpoints/update-github-webhook-recovery-checkpoint/index.ts"
import { webhookRecoveryLeaseMs, webhookRedeliveryRetentionMs } from "../constants.ts"
import { redeliverGitHubWebhookDeliveries } from "../redeliver-github-webhook-deliveries/index.ts"
import { scanGitHubWebhookDeliveries } from "../scan-github-webhook-deliveries/index.ts"
import type { GitHubWebhookRecoveryDependencies, GitHubWebhookRecoveryLease } from "../types.ts"

function leaseExpiresAtFrom(now: () => Date) {
  return new Date(now().getTime() + webhookRecoveryLeaseMs)
}

/**
 * Finds webhooks GitHub could not deliver to the Hub and asks GitHub to send them
 * again. One worker at a time holds the App's lease; returns false when another has it.
 */
export async function recoverGitHubWebhookDeliveries(
  dependencies: GitHubWebhookRecoveryDependencies,
): Promise<boolean> {
  const { appId, database, now } = dependencies
  const leaseId = randomUUID()
  const checkpoint = await claimGitHubWebhookRecoveryCheckpoint(database, {
    appId,
    leaseExpiresAt: leaseExpiresAtFrom(now),
    leaseId,
    now: now(),
  })
  if (!checkpoint) return false

  const lease: GitHubWebhookRecoveryLease = {
    renew: (data = {}) =>
      updateGitHubWebhookRecoveryCheckpoint(database, {
        appId,
        data: { ...data, leaseExpiresAt: leaseExpiresAtFrom(now) },
        leaseId,
      }),
  }
  try {
    let deliveredIds: string[] = []
    try {
      deliveredIds = await scanGitHubWebhookDeliveries(dependencies, lease, checkpoint)
    } catch (error) {
      // Redeliveries already recorded can still proceed while listing is unavailable.
      dependencies.logger.warn({ err: error }, "GitHub webhook delivery scan failed")
    }
    await redeliverGitHubWebhookDeliveries(dependencies, lease, deliveredIds)
    await deleteSettledGitHubWebhookRedeliveries(database, {
      before: new Date(now().getTime() - webhookRedeliveryRetentionMs),
    })
  } finally {
    await updateGitHubWebhookRecoveryCheckpoint(database, {
      appId,
      data: { leaseExpiresAt: null, leaseId: null },
      leaseId,
    })
  }
  return true
}
