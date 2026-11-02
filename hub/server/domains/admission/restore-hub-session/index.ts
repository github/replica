import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { lockRestorableHubSession } from "../../../repositories/hub-sessions/lock-restorable-hub-session/index.ts"
import { lockActiveMembershipAssignment } from "../../../repositories/membership-assignments/lock-active-membership-assignment/index.ts"
import { lockMembership } from "../../../repositories/memberships/lock-membership/index.ts"
import { getSessionRevocationState } from "../../../repositories/session-revocation-states/get-session-revocation-state/index.ts"

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

export async function restoreHubSession(
  digest: string,
  dependencies: {
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
      const revocation = await getSessionRevocationState(transaction)
      const session = await lockRestorableHubSession(transaction, parsedDigest)
      if (!session || !revocation || session.revocationRevision !== revocation.revision) {
        return null
      }
      const membership = await lockMembership(transaction, session.userId)
      if (membership?.id !== session.membershipId || membership.lifecycle !== "ACTIVE") return null
      const assignment = await lockActiveMembershipAssignment(transaction, session.membershipId)
      if (!assignment) return null
      const finalRevocation = await getSessionRevocationState(transaction)
      if (!finalRevocation || finalRevocation.revision !== revocation.revision) return null
      return {
        membershipId: session.membershipId,
        role: "administrator" as const,
        sessionId: session.id,
        userId: session.userId,
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
