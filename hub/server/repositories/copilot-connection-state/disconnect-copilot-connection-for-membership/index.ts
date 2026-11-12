import type { Prisma } from "../../../generated/prisma/client.ts"

export async function disconnectCopilotConnectionForMembership(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
  membershipId: string,
): Promise<boolean> {
  const result = await database.copilotConnectionState.updateMany({
    data: {
      connectedByMembershipId: null,
      generation: { increment: 1 },
      refusedAt: null,
      tokenDigest: null,
      verifiedAt: null,
    },
    where: { connectedByMembershipId: membershipId, key: "global" },
  })
  return result.count === 1
}
