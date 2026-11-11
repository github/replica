import type { Prisma } from "../../../generated/prisma/client.ts"

export async function deleteCopilotConnection(
  database: Pick<Prisma.TransactionClient, "copilotConnection">,
) {
  const result = await database.copilotConnection.deleteMany({ where: { key: "global" } })
  return result.count === 1
}
