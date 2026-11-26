import type { Prisma } from "../../../generated/prisma/client.ts"

export function findAgentClient(
  database: Pick<Prisma.TransactionClient, "agentClient">,
  id: string,
) {
  return database.agentClient.findUnique({ where: { id } })
}
