import type { Prisma } from "../../../generated/prisma/client.ts"
import type { MembershipInvitationRecord } from "../types.ts"

export async function getUsableMembershipInvitation(
  database: Prisma.TransactionClient,
  provider: string,
  issuer: string,
  subject: string,
  now: Date,
): Promise<MembershipInvitationRecord | null> {
  return (await database.membershipInvitation.findFirst({
    where: {
      provider,
      issuer,
      subject,
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "asc" },
  })) as MembershipInvitationRecord | null
}
