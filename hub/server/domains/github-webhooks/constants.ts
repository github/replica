const minute = 60 * 1_000
const day = 24 * 60 * minute

export const webhookRecoveryLeaseMs = 5 * minute
export const webhookRecoveryPagesPerRun = 10
export const webhookRedeliveriesPerRun = 30
export const maximumWebhookRedeliveryAttempts = 12
// GitHub can redeliver a webhook only for 3 days after the original delivery.
export const webhookRedeliveryWindowMs = 3 * day
export const webhookRedeliveryRetentionMs = 30 * day
// Rescans a few minutes past the previous scan so deliveries recorded mid-scan are not missed.
export const webhookScanOverlapMs = 5 * minute

/** Events the webhook route handles; others would be ignored if redelivered. */
export const recoverableWebhookEvents = new Set([
  "installation",
  "installation_repositories",
  "member",
  "membership",
  "organization",
  "team",
  "workflow_job",
  "workflow_run",
])
