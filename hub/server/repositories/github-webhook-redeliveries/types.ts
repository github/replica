export interface NewGitHubWebhookRedelivery {
  id: string
  githubDeliveryId: number
  event: string
  retryAt: Date
  expiresAt: Date
}

export interface ClaimedGitHubWebhookRedelivery {
  id: string
  githubDeliveryId: number
  attempts: number
}
