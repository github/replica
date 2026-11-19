import { claimDueGitHubWebhookRedeliveries } from "../../../repositories/github-webhook-redeliveries/claim-due-github-webhook-redeliveries/index.ts"
import { recordGitHubWebhookRedeliveryAttempt } from "../../../repositories/github-webhook-redeliveries/record-github-webhook-redelivery-attempt/index.ts"
import { settleGitHubWebhookRedeliveries } from "../../../repositories/github-webhook-redeliveries/settle-github-webhook-redeliveries/index.ts"
import {
  maximumWebhookRedeliveryAttempts,
  webhookRecoveryLeaseMs,
  webhookRedeliveriesPerRun,
} from "../constants.ts"
import type { GitHubWebhookRecoveryDependencies, GitHubWebhookRecoveryLease } from "../types.ts"

const minute = 60 * 1_000

function backoffMs(attempts: number) {
  return Math.min(minute * 2 ** (attempts - 1), 60 * minute)
}

/**
 * Settles redeliveries that reached the Hub, then asks GitHub to redeliver the due
 * ones with exponential backoff. The Hub's delivery receipts make a duplicate
 * redelivery harmless.
 */
export async function redeliverGitHubWebhookDeliveries(
  { database, logger, now, redeliver }: GitHubWebhookRecoveryDependencies,
  lease: GitHubWebhookRecoveryLease,
  deliveredIds: string[],
): Promise<void> {
  const currentTime = now()
  const staleBefore = new Date(currentTime.getTime() - webhookRecoveryLeaseMs)
  await settleGitHubWebhookRedeliveries(database, {
    deliveredIds,
    maximumAttempts: maximumWebhookRedeliveryAttempts,
    now: currentTime,
    staleBefore,
  })
  const claimed = await claimDueGitHubWebhookRedeliveries(database, {
    limit: webhookRedeliveriesPerRun,
    maximumAttempts: maximumWebhookRedeliveryAttempts,
    now: currentTime,
    staleBefore,
  })
  for (const redelivery of claimed) {
    if (!(await lease.renew())) return
    let failureCode: string | null = null
    try {
      if ((await redeliver(redelivery.githubDeliveryId)) === "unavailable") {
        failureCode = "remote_unavailable"
      }
    } catch (error) {
      failureCode = "github_unavailable"
      logger.warn({ deliveryId: redelivery.id, err: error }, "GitHub webhook redelivery failed")
    }
    await recordGitHubWebhookRedeliveryAttempt(database, {
      attempts: redelivery.attempts,
      failureCode,
      id: redelivery.id,
      retryAt: new Date(now().getTime() + backoffMs(redelivery.attempts)),
    })
  }
}
