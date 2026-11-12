import type { Prisma } from "../../../generated/prisma/client.ts"

export async function replaceCopilotConnection(
  database: Pick<Prisma.TransactionClient, "copilotConnection">,
  input: {
    connectedByMembershipId: string
    credentialDigest: string
    credentialProvider: string
    id: string
    verifiedAt: Date
  },
) {
  await database.copilotConnection.deleteMany({ where: { key: "global" } })
  return database.copilotConnection.create({
    data: { ...input, key: "global" },
  })
}
