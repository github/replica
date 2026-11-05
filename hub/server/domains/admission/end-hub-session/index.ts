import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { endHubSessionRecord } from "../../../repositories/hub-sessions/end-hub-session/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

export async function endHubSession(
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
): Promise<boolean> {
  const parsedDigest = digestSchema.parse(digest)
  return dependencies.database.$transaction(
    async (transaction) => {
      const session = await endHubSessionRecord(transaction, parsedDigest)
      if (!session) return false
      await createSecurityAudit(transaction, {
        id: dependencies.createId(),
        type: "session_ended",
        sessionId: session.id,
        membershipId: session.membershipId,
      })
      return true
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
