import type { Prisma } from "../../../generated/prisma/client.ts"
import type { MembershipInvitationRecord } from "../types.ts"

export async function getMembershipInvitations(
  database: Prisma.TransactionClient,
): Promise<MembershipInvitationRecord[]> {
  return (await database.membershipInvitation.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  })) as MembershipInvitationRecord[]
}
