import { staticGitHubIntegrationRecordId } from "#server/repositories/github-integration-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function advanceGitHubIntegrationGeneration(database: Prisma.TransactionClient) {
  await database.gitHubIntegrationState.upsert({
    where: { id: staticGitHubIntegrationRecordId },
    create: { id: staticGitHubIntegrationRecordId, generation: 1 },
    update: { generation: { increment: 1 } },
  })
}
