export interface GitHubWebhookRouteDependencies {
  webhookSecret: string
  installationId: string
  /** Applies one verified event and returns whether Hub acted on it. */
  handleEvent(name: string, payload: unknown): Promise<boolean>
}
