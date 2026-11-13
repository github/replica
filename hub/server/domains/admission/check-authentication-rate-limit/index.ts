import { Prisma } from "../../../generated/prisma/client.ts"

import { reserveAuthenticationRateLimit } from "../../../repositories/authentication-rate-limits/reserve-authentication-rate-limit/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"

class RateLimitDenialAuditError extends Error {
  constructor(options?: ErrorOptions) {
    super("The bootstrap rate-limit denial audit failed.", options)
    this.name = "RateLimitDenialAuditError"
  }
}

export async function checkAuthenticationRateLimit(
  input: {
    auditFirstDenial: boolean
    createId(): string
    limit: number
    operation: "start" | "callback" | "github_setup" | "github_test"
    subjectDigest: string
    windowSeconds: number
  },
  database: {
    $transaction<Result>(
      operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel },
    ): Promise<Result>
  },
): Promise<{ allowed: boolean; auditFailed: boolean }> {
  try {
    const allowed = await database.$transaction(
      async (transaction) => {
        const reservation = await reserveAuthenticationRateLimit(transaction, {
          auditFirstDenial: input.auditFirstDenial,
          limit: input.limit,
          operation: input.operation,
          subjectDigest: input.subjectDigest,
          windowSeconds: input.windowSeconds,
        })
        if (reservation.auditRequired) {
          try {
            await createSecurityAudit(transaction, {
              id: input.createId(),
              type: "bootstrap_attempt_denied",
              reason: "rate_limited",
            })
          } catch (error) {
            throw new RateLimitDenialAuditError({ cause: error })
          }
        }
        return reservation.allowed
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    )
    return { allowed, auditFailed: false }
  } catch (error) {
    if (error instanceof RateLimitDenialAuditError) {
      return { allowed: false, auditFailed: true }
    }
    throw error
  }
}
