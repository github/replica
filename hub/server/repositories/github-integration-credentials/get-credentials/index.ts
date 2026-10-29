import { staticGitHubIntegrationCredentialsId } from "#server/repositories/github-integration-credentials/constants"

import type { Prisma } from "../../../generated/prisma/client.ts"

export function getGitHubIntegrationCredentials(database: Prisma.TransactionClient) {
  return database.gitHubIntegrationCredentials.findUniqueOrThrow({
    where: { id: staticGitHubIntegrationCredentialsId },
  })
}
