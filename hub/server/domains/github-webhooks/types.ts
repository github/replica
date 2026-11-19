import type { Logger } from "pino"

import type { PrismaClient } from "../../generated/prisma/client.ts"
import type { GitHubWebhookDeliveryAttempt } from "../../integrations/github/create-github-webhook-deliveries-client/types.ts"

export interface GitHubWebhookRecoveryDependencies {
  appId: string
  database: PrismaClient
  installationId: string
  listDeliveries: (
    cursor: string | null,
  ) => Promise<{ deliveries: GitHubWebhookDeliveryAttempt[]; nextCursor: string | null }>
  logger: Pick<Logger, "error" | "warn">
  now: () => Date
  redeliver: (githubDeliveryId: number) => Promise<"requested" | "unavailable">
}

export interface GitHubWebhookRecoveryLease {
  /** Extends the lease; false once another worker has taken it over. */
  renew: (data?: {
    cursor?: string | null
    lastCompletedScanStartedAt?: Date
    scanStartedAt?: Date | null
  }) => Promise<boolean>
}
