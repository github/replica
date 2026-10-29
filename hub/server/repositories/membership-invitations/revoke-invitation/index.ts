import type { Prisma } from "../../../generated/prisma/client.ts"

export async function revokeMembershipInvitation(
  database: Prisma.TransactionClient,
  id: string,
  revokedAt: Date,
): Promise<boolean> {
  const updated = await database.membershipInvitation.updateMany({
    where: { id, consumedAt: null, revokedAt: null },
    data: { revokedAt },
  })
  return updated.count === 1
}
