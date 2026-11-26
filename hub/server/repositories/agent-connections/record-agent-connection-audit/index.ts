import type { Prisma } from "../../../generated/prisma/client.ts"

export function recordAgentConnectionAudit(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: {
    action: "agent_connection.approve" | "agent_connection.revoke"
    actorMembershipId: string
  } & ({ connectionId: string } | { clientId: string }),
) {
  // An approval happens before its connection exists, so it names the lasting agent
  // client instead of the short-lived authorization request.
  const target =
    "connectionId" in input
      ? { targetType: "agent_connection", targetId: input.connectionId }
      : { targetType: "agent_client", targetId: input.clientId }
  return database.securityAudit.create({
    data: {
      action: input.action,
      outcome: "SUCCESS",
      ...target,
      context: { actorMembershipId: input.actorMembershipId },
    },
  })
}
