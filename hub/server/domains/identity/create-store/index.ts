import { createIdentityRecords } from "#server/domains/identity/create-records"
import { withIdentityStoreLock } from "#server/domains/identity/with-store-lock"
import type { IdentityStore } from "#server/domains/identity/create-store/types"

import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function createIdentityStore(client: PrismaClient): IdentityStore {
  return {
    read: createIdentityRecords(client),
    lock: (operation) => withIdentityStoreLock(client, operation),
  }
}
