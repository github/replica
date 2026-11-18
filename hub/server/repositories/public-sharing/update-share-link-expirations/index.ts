import type { PrismaClient } from "../../../generated/prisma/client.ts"

export function updateShareLinkExpirations(
  database: PrismaClient,
  updates: Array<{ id: string; expiresAt: Date }>,
) {
  return database.$transaction(
    updates.map(({ id, expiresAt }) =>
      database.shareLink.update({ where: { id }, data: { expiresAt } }),
    ),
  )
}
