import type { Prisma } from "../../../generated/prisma/client.ts"

export async function refuseCopilotConnection(
  database: Pick<Prisma.TransactionClient, "copilotConnection">,
  input: {
    credentialDigest: string
    credentialProvider: string
    id: string
    refusedAt: Date
  },
) {
  const result = await database.copilotConnection.updateMany({
    where: { id: input.id, key: "global" },
    data: {
      credentialDigest: input.credentialDigest,
      credentialProvider: input.credentialProvider,
      refusedAt: input.refusedAt,
    },
  })
  return result.count === 1
}
