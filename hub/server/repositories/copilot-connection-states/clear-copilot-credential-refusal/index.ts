import type { Prisma } from "../../../generated/prisma/client.ts"

export function clearCopilotCredentialRefusal(
  database: Pick<Prisma.TransactionClient, "copilotConnectionState">,
) {
  return database.copilotConnectionState.update({
    where: { key: "global" },
    data: {
      refusedAt: null,
      refusedCredentialDigest: null,
      refusedCredentialProvider: null,
    },
  })
}
