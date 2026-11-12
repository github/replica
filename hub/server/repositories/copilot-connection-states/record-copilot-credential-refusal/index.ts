import type { Prisma } from "../../../generated/prisma/client.ts"

export async function recordCopilotCredentialRefusal(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
  input: {
    credentialDigest: string
    credentialProvider: string
    refusedAt: Date
  },
) {
  const result = await database.copilotConnectionState.updateMany({
    where: { key: "global" },
    data: {
      refusedAt: input.refusedAt,
      refusedCredentialDigest: input.credentialDigest,
      refusedCredentialProvider: input.credentialProvider,
    },
  })
  return result.count === 1
}
