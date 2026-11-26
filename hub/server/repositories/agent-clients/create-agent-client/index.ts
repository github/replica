import type { Prisma } from "../../../generated/prisma/client.ts"

export function createAgentClient(
  database: Pick<Prisma.TransactionClient, "agentClient">,
  data: { id: string; name: string; redirectUris: string[] },
) {
  return database.agentClient.create({ data })
}
