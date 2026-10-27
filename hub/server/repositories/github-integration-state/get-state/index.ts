import { staticGitHubIntegrationRecordId } from "#server/repositories/github-integration-state/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getGitHubIntegrationState(database: Prisma.TransactionClient) {
  return database.gitHubIntegrationState.findUniqueOrThrow({
    where: { id: staticGitHubIntegrationRecordId },
  })
}
