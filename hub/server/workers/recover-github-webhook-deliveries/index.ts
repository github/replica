import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"
import { logger } from "../../integrations/pino/index.ts"

/** Asks GitHub to redeliver webhooks that could not reach the Hub. */
export async function recoverGitHubWebhookDeliveriesJob(): Promise<void> {
  if (!readAuthenticationConfigurationState(process.env).githubSettingsPresent) return
  const credentials = readGitHubAppConfiguration(process.env).appCredentials
  if (!credentials) return

  const [{ recoverGitHubWebhookDeliveries }, { createGitHubWebhookDeliveriesClient }, { prisma }] =
    await Promise.all([
      import("../../domains/github-webhooks/recover-github-webhook-deliveries/index.ts"),
      import("../../integrations/github/create-github-webhook-deliveries-client/index.ts"),
      import("../../integrations/prisma/index.ts"),
    ])
  const client = createGitHubWebhookDeliveriesClient(credentials)
  await recoverGitHubWebhookDeliveries({
    appId: credentials.appId,
    database: prisma,
    installationId: credentials.installationId,
    listDeliveries: (cursor) => client.listDeliveries(cursor),
    logger,
    now: () => new Date(),
    redeliver: (id) => client.redeliver(id),
  })
}
