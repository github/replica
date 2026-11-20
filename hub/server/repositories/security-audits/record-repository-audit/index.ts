import type { Prisma } from "../../../generated/prisma/client.ts"

export async function recordRepositoryAudit(
  database: Pick<Prisma.TransactionClient, "securityAudit">,
  input: {
    repositoryId: string
    actorMembershipId: string
    action: "prototype.registered" | "share_link.created" | "share_link.revoked"
    targetId: string
  },
) {
  await database.securityAudit.create({
    data: {
      repositoryId: input.repositoryId,
      action: input.action,
      context: { actorMembershipId: input.actorMembershipId },
      outcome: "SUCCESS",
      targetId: input.targetId,
      targetType: input.action.startsWith("prototype.") ? "prototype" : "share_link",
    },
  })
}
