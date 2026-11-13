import type { Prisma } from "../../../generated/prisma/client.ts"

export async function disconnectCopilotConnectionForMembership(
  database: Pick<Prisma.TransactionClient, "copilotConnection" | "copilotConnectionState">,
  membershipId: string,
): Promise<{ connectionId: string; credentialProvider: string } | null> {
  const connection = await database.copilotConnection.findFirst({
    select: { credentialProvider: true, id: true },
    where: { connectedByMembershipId: membershipId, key: "global" },
  })
  if (!connection) return null
  await database.copilotConnection.delete({ where: { id: connection.id } })
  await database.copilotConnectionState.update({
    data: { generation: { increment: 1 } },
    where: { key: "global" },
  })
  return { connectionId: connection.id, credentialProvider: connection.credentialProvider }
}
