import type { GitHubWebhookDelivery } from "../../../../repositories/github-webhook-deliveries/types.ts"

export interface GitHubWebhookRouteDependencies {
  webhookSecret: string
  installationId: string
  /** Applies one verified event and returns whether Hub acted on it. */
  handleEvent(
    name: string,
    payload: unknown,
    delivery: Omit<GitHubWebhookDelivery, "event">,
  ): Promise<boolean>
}
