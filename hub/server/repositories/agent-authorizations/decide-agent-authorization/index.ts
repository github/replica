import type { Prisma } from "../../../generated/prisma/client.ts"

/**
 * Settles a pending request once. Approval binds the person's session and stores only
 * the code's digest; cancelling uses the request up so it cannot be approved later.
 */
export async function decideAgentAuthorization(
  database: Pick<Prisma.TransactionClient, "agentAuthorization">,
  id: string,
  decision: { sessionId: string; codeDigest: string } | null,
) {
  const now = new Date()
  const result = await database.agentAuthorization.updateMany({
    where: { id, expiresAt: { gt: now }, approvedAt: null, consumedAt: null },
    data: decision ? { ...decision, approvedAt: now } : { consumedAt: now },
  })
  return result.count === 1
}
