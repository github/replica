import type { Prisma } from "../../../generated/prisma/client.ts"

export async function consumeMembershipInvitation(
  database: Prisma.TransactionClient,
  id: string,
  activatedIdentityId: string,
  activatedMembershipId: string,
  consumedAt: Date,
): Promise<boolean> {
  const updated = await database.membershipInvitation.updateMany({
    where: { id, consumedAt: null, revokedAt: null, expiresAt: { gt: consumedAt } },
    data: { activatedIdentityId, activatedMembershipId, consumedAt },
  })
  return updated.count === 1
}
