import { staticGitHubIntegrationRecordId } from "#server/repositories/github-integration-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function ensureGitHubIntegrationState(database: Prisma.TransactionClient) {
  await database.gitHubIntegrationState.upsert({
    where: { id: staticGitHubIntegrationRecordId },
    create: { id: staticGitHubIntegrationRecordId },
    update: {},
  })
}
