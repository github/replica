import type { KeyObject } from "node:crypto"

export interface GitHubWebhookDeliveriesClientInput {
  appId: string
  privateKey: KeyObject
}

export interface GitHubWebhookDeliveriesClientOptions {
  apiUrl?: string
  fetch?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

/** One attempt to deliver a webhook. Redelivered attempts share the original guid. */
export interface GitHubWebhookDeliveryAttempt {
  id: number
  guid: string
  deliveredAt: Date
  /** 0 when GitHub could not reach the Hub at all. */
  statusCode: number
  event: string
  installationId: number | null
}
