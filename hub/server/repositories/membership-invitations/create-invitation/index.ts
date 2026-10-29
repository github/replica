import type {
  MembershipInvitationInput,
  MembershipInvitationRecord,
} from "#server/repositories/membership-invitations/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function createMembershipInvitation(
  database: Prisma.TransactionClient,
  input: MembershipInvitationInput,
): Promise<MembershipInvitationRecord> {
  return (await database.membershipInvitation.create({
    data: input,
  })) as MembershipInvitationRecord
}
