import { createIdentityRecords } from "#server/domains/identity/create-records"
import { ensureGitHubIntegrationCredentials } from "#server/repositories/github-integration-credentials/ensure-credentials"
import { withIdentityStoreLock as withRepositoryLock } from "#server/repositories/identity-store-state/with-store-lock"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityStoreLock<T>(
  client: PrismaClient,
  operation: (records: IdentityRecords) => Promise<T>,
): Promise<T> {
  return withRepositoryLock(client, async (database) => {
    await ensureGitHubIntegrationCredentials(database)
    return operation(createIdentityRecords(database), database)
  })
}
