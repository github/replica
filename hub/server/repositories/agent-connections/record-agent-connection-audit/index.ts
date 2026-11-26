import type { Prisma } from "../../../generated/prisma/client.ts"

export function recordAgentConnectionAudit(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: {
    action: "agent_connection.approve" | "agent_connection.revoke"
    actorMembershipId: string
    connectionId?: string
    authorizationId?: string
  },
) {
  const { action, actorMembershipId, connectionId, authorizationId } = input
  return database.securityAudit.create({
    data: {
      action,
      outcome: "SUCCESS",
      targetType: connectionId ? "agent_connection" : "agent_authorization",
      targetId: connectionId ?? authorizationId ?? null,
      context: {
        actorMembershipId,
        ...(connectionId ? { connectionId } : {}),
        ...(authorizationId ? { authorizationId } : {}),
      },
    },
  })
}
