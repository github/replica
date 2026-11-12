import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveCopilotConnectionState(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
  input:
    | { operation: "connect"; membershipId: string; tokenDigest: string }
    | { operation: "disconnect" },
) {
  if (input.operation === "connect") {
    await database.copilotConnectionState.update({
      data: {
        connectedByMembershipId: input.membershipId,
        generation: { increment: 1 },
        refusedAt: null,
        tokenDigest: input.tokenDigest,
        verifiedAt: new Date(),
      },
      where: { key: "global" },
    })
    return
  }
  await database.copilotConnectionState.update({
    data: {
      connectedByMembershipId: null,
      generation: { increment: 1 },
      refusedAt: null,
      tokenDigest: null,
      verifiedAt: null,
    },
    where: { key: "global" },
  })
}
