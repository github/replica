import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { getSensitiveAuthorizationAuditData } from "../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import { endAllOpenHubSessions } from "../../../repositories/hub-sessions/end-all-open-hub-sessions/index.ts"
import { lockLiveHubSession } from "../../../repositories/hub-sessions/lock-live-hub-session/index.ts"
import { lockEffectiveAdministrators } from "../../../repositories/memberships/lock-effective-administrators/index.ts"
import { incrementSessionRevocationState } from "../../../repositories/session-revocation-states/increment-session-revocation-state/index.ts"
import { cancelOpenSensitiveAuthorizations } from "../../../repositories/sensitive-authorizations/cancel-open-sensitive-authorizations/index.ts"
import { isSensitiveAuthorizationCurrent } from "../../../repositories/sensitive-authorizations/is-sensitive-authorization-current/index.ts"
import { lockSensitiveAuthorization } from "../../../repositories/sensitive-authorizations/lock-sensitive-authorization/index.ts"
import { markSensitiveAuthorizationContinued } from "../../../repositories/sensitive-authorizations/mark-sensitive-authorization-continued/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  SessionRevocationDeniedError,
  SessionRevocationPersistenceError,
  SessionRevocationTransactionConflictError,
} from "../errors.ts"

const inputSchema = z
  .object({
    authorizationId: z.uuid(),
    hubSessionId: z.uuid(),
  })
  .strict()

interface SessionRevocationDatabase {
  $queryRaw: Prisma.TransactionClient["$queryRaw"]
  securityAudit: Prisma.TransactionClient["securityAudit"]
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export async function endAllHubSessions(database: SessionRevocationDatabase, rawInput: unknown) {
  const input = inputSchema.parse(rawInput)
  try {
    return await runWithBoundedRetries(
      () =>
        database
          .$transaction(
            async (transaction) => {
              const authorization = await lockSensitiveAuthorization(
                transaction,
                input.authorizationId,
              )
              if (!authorization || authorization.operation !== "END_ALL_HUB_SESSIONS") {
                throw new SessionRevocationDeniedError("invalid_operation")
              }
              if (authorization.hubSessionId !== input.hubSessionId) {
                throw new SessionRevocationDeniedError("session_mismatch")
              }
              if (!(await lockLiveHubSession(transaction, authorization.hubSessionId))) {
                throw new SessionRevocationDeniedError("session_mismatch")
              }
              const administrators = await lockEffectiveAdministrators(transaction)
              if (
                !administrators.some(
                  ({ membershipId }) => membershipId === authorization.actorMembershipId,
                )
              ) {
                throw new SessionRevocationDeniedError("not_authorized")
              }
              if (authorization.cancelledAt) {
                throw new SessionRevocationDeniedError("cancelled")
              }
              if (authorization.continuedAt) {
                throw new SessionRevocationDeniedError("used")
              }
              if (authorization.expired) {
                throw new SessionRevocationDeniedError("expired")
              }
              if (!authorization.verifiedAt) {
                throw new SessionRevocationDeniedError("verification_required")
              }
              if (
                !(await isSensitiveAuthorizationCurrent(transaction, {
                  authorizationId: input.authorizationId,
                  hubSessionId: input.hubSessionId,
                }))
              ) {
                throw new SessionRevocationDeniedError("expired")
              }
              await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
              const revocation = await incrementSessionRevocationState(transaction)
              if (!revocation) {
                throw new SessionRevocationDeniedError("not_authorized")
              }
              const cancelledAuthorizationCount = await cancelOpenSensitiveAuthorizations(
                transaction,
                input.authorizationId,
              )
              const endedSessionCount = await endAllOpenHubSessions(transaction)
              await createSecurityAudit(transaction, {
                actorMembershipId: authorization.actorMembershipId,
                cancelledAuthorizationCount,
                endedSessionCount,
                id: randomUUID(),
                revision: revocation.revision,
                type: "all_hub_sessions_ended",
              })
              return {
                cancelledAuthorizationCount,
                endedSessionCount,
                revision: revocation.revision,
              }
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
          .catch((error: unknown) => {
            if (classifyPrismaTransactionError(error) === "retryable") {
              throw new SessionRevocationTransactionConflictError({ cause: error })
            }
            throw error
          }),
      (error) => error instanceof SessionRevocationTransactionConflictError,
    )
  } catch (error) {
    const reason =
      error instanceof SessionRevocationDeniedError
        ? error.reason
        : error instanceof SessionRevocationTransactionConflictError
          ? "retry_exhausted"
          : "transaction_error"
    const authorization = await getSensitiveAuthorizationAuditData(database, input.authorizationId)
    if (authorization?.operation === "END_ALL_HUB_SESSIONS") {
      try {
        await database.$transaction(async (transaction) => {
          if (!(error instanceof SessionRevocationDeniedError)) {
            await createSecurityAudit(transaction, {
              actorMembershipId: authorization.actorMembershipId,
              id: randomUUID(),
              reason:
                error instanceof SessionRevocationTransactionConflictError
                  ? "retry_exhausted"
                  : "transaction_error",
              type: "all_hub_sessions_end_failed",
            })
          }
          await createSecurityAudit(transaction, {
            actorMembershipId: authorization.actorMembershipId,
            authorizationId: input.authorizationId,
            id: randomUUID(),
            operation: authorization.operation,
            phase: reason === "expired" || authorization.expired ? "expired" : "denied",
            reason,
            targetCount: authorization.targetCount,
            type: "administrator_authorization",
          })
        })
      } catch (auditError) {
        throw new AggregateError(
          [error, auditError],
          "The session revocation denial and its audits could not all be recorded.",
          { cause: auditError },
        )
      }
    }
    throw error instanceof SessionRevocationTransactionConflictError
      ? new SessionRevocationPersistenceError({ cause: error })
      : error
  }
}
