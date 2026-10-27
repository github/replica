import { createIdentityRecords } from "#server/domains/identity/create-records"
import { ensureGitHubIntegrationState } from "#server/repositories/github-integration-state/ensure-state"
import { withIdentityStoreLock as withRepositoryLock } from "#server/repositories/identity-store-state/with-store-lock"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityStoreLock<T>(
  client: PrismaClient,
  operation: (records: IdentityRecords, database: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withRepositoryLock(client, async (database) => {
    await ensureGitHubIntegrationState(database)
    return operation(createIdentityRecords(database), database)
  })
}
