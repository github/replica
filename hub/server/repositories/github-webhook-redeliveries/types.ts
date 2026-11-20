export interface NewGitHubWebhookRedelivery {
  id: string
  githubDeliveryId: number | string
  event: string
  retryAt: Date
  expiresAt: Date
}

export interface ClaimedGitHubWebhookRedelivery {
  id: string
  githubDeliveryId: number | string
  attempts: number
}
