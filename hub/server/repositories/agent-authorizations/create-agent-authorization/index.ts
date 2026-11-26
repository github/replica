import type { Prisma } from "../../../generated/prisma/client.ts"

/** Drops expired requests first, so abandoned sign-ins do not pile up. */
export async function createAgentAuthorization(
  database: Pick<Prisma.TransactionClient, "agentAuthorization">,
  data: Prisma.AgentAuthorizationUncheckedCreateInput,
) {
  await database.agentAuthorization.deleteMany({ where: { expiresAt: { lte: new Date() } } })
  return database.agentAuthorization.create({ data, select: { id: true } })
}
