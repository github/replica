import type { Prisma } from "../../../generated/prisma/client.ts"

export function createAgentConnection(
  database: Pick<Prisma.TransactionClient, "agentConnection">,
  data: Prisma.AgentConnectionUncheckedCreateInput,
) {
  return database.agentConnection.create({
    data,
    select: { id: true, expiresAt: true },
  })
}
