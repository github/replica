import type { Prisma } from "../../../generated/prisma/client.ts"
import type { CanvasAuthorityReference } from "../../canvas/authority/index.ts"

export function listAgentConnections(
  database: Pick<Prisma.TransactionClient, "agentConnection">,
  owner: CanvasAuthorityReference,
) {
  const now = new Date()
  return database.agentConnection.findMany({
    where: { ...owner, revokedAt: null, inactiveAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      inactiveAt: true,
      client: { select: { name: true } },
    },
  })
}
