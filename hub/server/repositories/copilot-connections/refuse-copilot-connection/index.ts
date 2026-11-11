import type { Prisma } from "../../../generated/prisma/client.ts"

export async function refuseCopilotConnection(
  database: Pick<Prisma.TransactionClient, "copilotConnection">,
  input: { id: string; refusedAt: Date; tokenDigest: string },
) {
  const result = await database.copilotConnection.updateMany({
    where: { id: input.id, key: "global" },
    data: { refusedAt: input.refusedAt, tokenDigest: input.tokenDigest },
  })
  return result.count === 1
}
