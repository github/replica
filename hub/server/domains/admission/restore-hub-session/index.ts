import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { lockRestorableHubSession } from "../../../repositories/hub-sessions/lock-restorable-hub-session/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

export async function restoreHubSession(
  digest: string,
  dependencies: {
    createId(): string
    database: {
      $transaction<Result>(
        operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
        options: { isolationLevel: Prisma.TransactionIsolationLevel },
      ): Promise<Result>
    }
  },
) {
  const parsedDigest = digestSchema.parse(digest)
  return dependencies.database.$transaction(
    async (transaction) => {
      const revocation = await lockSessionRevocationState(transaction)
      const session = await lockRestorableHubSession(transaction, parsedDigest)
      if (!session || !revocation || session.revocationRevision !== revocation.revision) {
        return null
      }
      const membership = await lockMembership(transaction, session.userId)
      if (membership?.id !== session.membershipId || membership.lifecycle !== "ACTIVE") return null
      const assignment = await lockActiveMembershipAssignment(transaction, session.membershipId)
      if (!assignment) return null
      await createSecurityAudit(transaction, {
        id: dependencies.createId(),
        type: "session_restored",
        sessionId: session.id,
        membershipId: session.membershipId,
      })
      return {
        membershipId: session.membershipId,
        role:
          assignment.role === "ADMINISTRATOR" ? ("administrator" as const) : ("member" as const),
        sessionId: session.id,
        userId: session.userId,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
