import type { PrismaClient } from "../../../generated/prisma/client.ts"

export async function getCopilotConnectionState(
  database: Pick<PrismaClient, "copilotConnectionState">,
) {
  const state = await database.copilotConnectionState.findUniqueOrThrow({
    where: { key: "global" },
    include: {
      connectedByMembership: {
        include: {
          user: { include: { profile: true } },
        },
      },
    },
  })
  return {
    connected: state.connectedByMembershipId !== null,
    connectedAt: state.connectedByMembershipId ? state.updatedAt : null,
    connectedBy: state.connectedByMembership
      ? {
          login: state.connectedByMembership.user.profile?.login ?? null,
          membershipId: state.connectedByMembership.id,
          name: state.connectedByMembership.user.profile?.name ?? null,
        }
      : null,
    generation: state.generation,
    refusedAt: state.refusedAt,
    tokenDigest: state.tokenDigest,
    verifiedAt: state.verifiedAt,
  }
}
