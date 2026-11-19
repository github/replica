import type { Prisma } from "../../../generated/prisma/client.ts"

export function recordCanvasAudit(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: {
    action:
      | "canvas_pairing.create"
      | "canvas_pairing.approve"
      | "canvas_pairing.consume"
      | "canvas_connection.renew"
      | "canvas_connection.revoke"
      | "canvas_connection.activity"
    outcome: "SUCCESS" | "DENIED" | "FAILURE"
    repositoryId?: string
    actorMembershipId?: string
    pairingId?: string
    connectionId?: number
    source: "browser" | "canvas"
  },
) {
  const { action, outcome, repositoryId, actorMembershipId, pairingId, connectionId, source } =
    input
  return database.securityAudit.create({
    data: {
      action,
      outcome,
      targetType: action.startsWith("canvas_pairing.") ? "canvas_pairing" : "canvas_connection",
      targetId: pairingId ?? (connectionId === undefined ? null : String(connectionId)),
      context: {
        source,
        ...(repositoryId ? { repositoryId } : {}),
        ...(actorMembershipId ? { actorMembershipId } : {}),
        ...(pairingId ? { pairingId } : {}),
        ...(connectionId === undefined ? {} : { connectionId }),
      },
    },
  })
}
