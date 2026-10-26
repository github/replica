import { createIdentityRecords } from "#server/domains/identity/create-records"
import { withIdentityLock } from "#server/repositories/identity-state/with-identity-lock"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function withIdentityStoreLock<T>(
  client: PrismaClient,
  operation: (records: IdentityRecords) => Promise<T>,
): Promise<T> {
  return withIdentityLock(client, (database) => operation(createIdentityRecords(database)))
}
