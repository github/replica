import { staticGitHubIntegrationCredentialsId } from "#server/repositories/github-integration-credentials/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function ensureGitHubIntegrationCredentials(database: Prisma.TransactionClient) {
  await database.gitHubIntegrationCredentials.upsert({
    where: { id: staticGitHubIntegrationCredentialsId },
    create: { id: staticGitHubIntegrationCredentialsId },
    update: {},
  })
}
