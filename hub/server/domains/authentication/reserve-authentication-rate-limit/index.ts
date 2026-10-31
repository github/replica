import { randomUUID } from "node:crypto"

import { Prisma } from "../../../generated/prisma/client.ts"
import { markAuthenticationRateLimitAudited } from "../../../repositories/authentication-rate-limits/mark-authentication-rate-limit-audited/index.ts"
import { reserveAuthenticationRateLimit as reserveBucket } from "../../../repositories/authentication-rate-limits/reserve-authentication-rate-limit/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"

interface Database {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export function reserveAuthenticationRateLimit(
  database: Database,
  input: {
    operation: "callback" | "start"
    provider: string
    requestIp: string
  },
  dependencies: {
    createAudit?: typeof createSecurityAudit
    createId?: () => string
  } = {},
): Promise<{ reserved: boolean }> {
  const createAudit = dependencies.createAudit ?? createSecurityAudit
  const createId = dependencies.createId ?? randomUUID
  const scope = input.operation === "start" ? "github_start" : "github_callback"
  const keyDigest = hashAuthenticationValue(input.requestIp)
  return database.$transaction(
    async (transaction) => {
      const reservation = await reserveBucket(transaction, {
        id: createId(),
        keyDigest,
        limit: input.operation === "start" ? 10 : 20,
        scope,
        windowSeconds: 10 * 60,
      })
      if (reservation.reserved) return { reserved: true }
      if (reservation.shouldAuditDenial) {
        const primaryError = new AuthenticationProofError(
          "rate_limited",
          "The authentication rate limit was exceeded.",
        )
        await recordAuthenticationDenial(primaryError, () =>
          createAudit(transaction, {
            id: createId(),
            type: "authentication_attempt_denied",
            provider: input.provider,
            reason: "rate_limited",
          }),
        )
        await markAuthenticationRateLimitAudited(transaction, { keyDigest, scope })
      }
      return { reserved: false }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  )
}
