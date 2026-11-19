import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { endHubSessionRecord } from "../../../repositories/hub-sessions/end-hub-session/index.ts"
import { lockSessionAuthorityChanges } from "../../../repositories/hub-sessions/lock-session-authority-changes/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { SessionTerminationConflictError } from "../errors.ts"

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)

export async function endHubSession(
  digest: string,
  dependencies: {
    createId(): string
    database: {
      $transaction<Result>(
        operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
        options: {
          isolationLevel: Prisma.TransactionIsolationLevel
          maxWait: number
          timeout: number
        },
      ): Promise<Result>
    }
  },
): Promise<boolean> {
  const parsedDigest = digestSchema.parse(digest)
  return dependencies.database
    .$transaction(
      async (transaction) => {
        await lockSessionAuthorityChanges(transaction, { timeoutMs: 500 })
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
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 2_000,
        timeout: 5_000,
      },
    )
    .catch((error: unknown) => {
      if (classifyPrismaTransactionError(error) === "retryable") {
        throw new SessionTerminationConflictError({ cause: error })
      }
      throw error
    })
}
