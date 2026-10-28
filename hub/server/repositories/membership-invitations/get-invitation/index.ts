import type { Prisma } from "../../../generated/prisma/client.ts"
import type { MembershipInvitationRecord } from "../types.ts"

export async function getMembershipInvitation(
  database: Prisma.TransactionClient,
  id: string,
): Promise<MembershipInvitationRecord | null> {
  return (await database.membershipInvitation.findUnique({
    where: { id },
  })) as MembershipInvitationRecord | null
}
