import type { Prisma } from "../../../generated/prisma/client.ts"

export async function revokeExpiredMembershipInvitations(
  database: Prisma.TransactionClient,
  revokedAt: Date,
) {
  await database.membershipInvitation.updateMany({
    where: { consumedAt: null, revokedAt: null, expiresAt: { lte: revokedAt } },
    data: { revokedAt },
  })
}
