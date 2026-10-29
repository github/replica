import { staticGitHubIntegrationCredentialsId } from "#server/repositories/github-integration-credentials/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveGitHubIntegrationCredentials(
  database: Prisma.TransactionClient,
  encryptedCredentials: string,
) {
  await database.gitHubIntegrationCredentials.upsert({
    where: { id: staticGitHubIntegrationCredentialsId },
    create: { id: staticGitHubIntegrationCredentialsId, encryptedCredentials },
    update: { encryptedCredentials },
  })
}
