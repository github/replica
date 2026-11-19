import type { Prisma } from "../../../generated/prisma/client.ts"

export async function lockSharingSetting(database: Prisma.TransactionClient, key: string) {
  const rows = await database.$queryRaw<
    Array<{ id: string; publicSharingEnabled: boolean; revision: number }>
  >`
    SELECT id, public_sharing_enabled AS "publicSharingEnabled", revision
    FROM sharing_settings
    WHERE key = ${key}
    FOR UPDATE
  `
  return rows[0] ?? null
}
