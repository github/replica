import { auditRetentionMs } from "#server/repositories/security-audits/constants"
import type { AuditInput } from "#server/repositories/security-audits/types"

import type { Prisma } from "../../../generated/prisma/client.ts"

export async function saveSecurityAudit(database: Prisma.TransactionClient, data: AuditInput) {
  const context = data.context ?? {}
  const validContext =
    Object.keys(context).every((key) => key === "reason" || key === "source") &&
    Object.values(context).every((value) => /^[a-z][a-z0-9_]{0,63}$/.test(value))
  if (
    !/^[a-z][a-z0-9_.]{0,79}$/.test(data.event) ||
    !["succeeded", "denied", "failed"].includes(data.outcome ?? "succeeded") ||
    !validContext
  ) {
    throw new Error("Security audit input is invalid.")
  }
  await database.securityAudit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - auditRetentionMs) } },
  })
  await database.securityAudit.create({
    data: {
      ...data,
      outcome: data.outcome ?? "succeeded",
      targetMembershipId: data.targetMembershipId ?? null,
      invitationId: data.invitationId ?? null,
      context,
    },
  })
}
