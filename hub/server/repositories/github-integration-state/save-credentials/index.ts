import { staticGitHubIntegrationRecordId } from "#server/repositories/github-integration-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveGitHubIntegrationCredentials(
  database: Prisma.TransactionClient,
  encryptedCredentials: string,
) {
  await database.gitHubIntegrationState.upsert({
    where: { id: staticGitHubIntegrationRecordId },
    create: { id: staticGitHubIntegrationRecordId, encryptedCredentials },
    update: { encryptedCredentials },
  })
}
