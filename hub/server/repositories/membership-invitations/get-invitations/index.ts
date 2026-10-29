import type { Prisma } from "../../../generated/prisma/client.ts"
import type { MembershipInvitationPage, MembershipInvitationRecord } from "../types.ts"

export async function getMembershipInvitations(
  database: Prisma.TransactionClient,
  cursor: string | null = null,
): Promise<MembershipInvitationPage> {
  const records = (await database.membershipInvitation.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
    take: 101,
  })) as MembershipInvitationRecord[]
  const hasMore = records.length > 100
  const invitations = hasMore ? records.slice(0, 100) : records
  return {
    invitations,
    nextCursor: hasMore ? (invitations.at(-1)?.id ?? null) : null,
  }
}
