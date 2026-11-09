import { randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { getSensitiveAuthorizationAuditData } from "../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import { lockLiveHubSession } from "../../../repositories/hub-sessions/lock-live-hub-session/index.ts"
import { lockSensitiveAuthorization } from "../../../repositories/sensitive-authorizations/lock-sensitive-authorization/index.ts"
import { markSensitiveAuthorizationContinued } from "../../../repositories/sensitive-authorizations/mark-sensitive-authorization-continued/index.ts"
import { createAdministratorManagementRepositories } from "../../administrator-management/create-administrator-management-repositories/index.ts"
import { designateHubAdministratorsWithRepositories } from "../../administrator-management/designate-hub-administrators-with-repositories/index.ts"
import {
  AdministratorManagementDeniedError,
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "../../administrator-management/errors.ts"
import { revokeHubAdministratorWithRepositories } from "../../administrator-management/revoke-hub-administrator-with-repositories/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { AdministratorAuthorizationDeniedError } from "../errors.ts"

const inputSchema = z
  .object({
    hubSessionId: z.uuid(),
    id: z.uuid(),
    operation: z.enum(["DESIGNATE_ADMINISTRATORS", "REVOKE_ADMINISTRATOR"]),
    targetMembershipIds: z.array(z.uuid()).min(1).max(50),
  })
  .strict()

interface AdministratorAuthorizationDatabase {
  $queryRaw: Prisma.TransactionClient["$queryRaw"]
  $transaction: Prisma.TransactionClient["$transaction"]
  securityAudit: Prisma.TransactionClient["securityAudit"]
}

function sameTargets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export async function continueAdministratorAuthorization(
  database: AdministratorAuthorizationDatabase,
  rawInput: unknown,
) {
  const input = inputSchema.parse(rawInput)
  try {
    return await runWithBoundedRetries(
      () =>
        database
          .$transaction(
            async (transaction) => {
              const authorization = await lockSensitiveAuthorization(transaction, input.id)
              if (!authorization) {
                throw new AdministratorAuthorizationDeniedError("invalid_operation")
              }
              if (authorization.hubSessionId !== input.hubSessionId) {
                throw new AdministratorAuthorizationDeniedError("session_mismatch")
              }
              if (!(await lockLiveHubSession(transaction, authorization.hubSessionId))) {
                throw new AdministratorAuthorizationDeniedError("session_mismatch")
              }
              if (
                authorization.operation !== input.operation ||
                !sameTargets(authorization.targetMembershipIds, input.targetMembershipIds)
              ) {
                throw new AdministratorAuthorizationDeniedError("invalid_operation")
              }
              if (authorization.cancelledAt) {
                throw new AdministratorAuthorizationDeniedError("cancelled")
              }
              if (authorization.continuedAt) {
                throw new AdministratorAuthorizationDeniedError("used")
              }
              if (authorization.expired) {
                throw new AdministratorAuthorizationDeniedError("expired")
              }
              if (!authorization.verifiedAt) {
                throw new AdministratorAuthorizationDeniedError("verification_required")
              }
              await markSensitiveAuthorizationContinued(transaction, input.id)
              const repositories = createAdministratorManagementRepositories(transaction)
              const result =
                input.operation === "DESIGNATE_ADMINISTRATORS"
                  ? await designateHubAdministratorsWithRepositories(
                      repositories,
                      {
                        actorMembershipId: authorization.actorMembershipId,
                        targetMembershipIds: input.targetMembershipIds,
                      },
                      randomUUID,
                    )
                  : await revokeHubAdministratorWithRepositories(
                      repositories,
                      {
                        actorMembershipId: authorization.actorMembershipId,
                        targetMembershipId: input.targetMembershipIds[0]!,
                      },
                      randomUUID,
                    )
              await repositories.createSecurityAudit({
                actorMembershipId: authorization.actorMembershipId,
                authorizationId: input.id,
                id: randomUUID(),
                operation: input.operation,
                phase: "completed",
                targetCount: input.targetMembershipIds.length,
                type: "administrator_authorization",
              })
              return result
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
          .catch((error: unknown) => {
            if (classifyPrismaTransactionError(error) === "retryable") {
              throw new AdministratorManagementTransactionConflictError({ cause: error })
            }
            throw error
          }),
      (error) => error instanceof AdministratorManagementTransactionConflictError,
    )
  } catch (error) {
    const reason =
      error instanceof AdministratorAuthorizationDeniedError
        ? error.reason
        : error instanceof AdministratorManagementDeniedError
          ? error.reason
          : error instanceof AdministratorManagementTransactionConflictError
            ? "retry_exhausted"
            : "transaction_error"
    const authorization = await getSensitiveAuthorizationAuditData(database, input.id)
    if (authorization) {
      try {
        await database.$transaction(async (transaction) => {
          if (error instanceof AdministratorManagementDeniedError) {
            await createSecurityAudit(transaction, {
              actorMembershipId: authorization.actorMembershipId,
              id: randomUUID(),
              operation: input.operation === "DESIGNATE_ADMINISTRATORS" ? "designate" : "revoke",
              reason: error.reason,
              type: "administrator_management_denied",
            })
          } else if (!(error instanceof AdministratorAuthorizationDeniedError)) {
            await createSecurityAudit(transaction, {
              actorMembershipId: authorization.actorMembershipId,
              id: randomUUID(),
              operation: input.operation === "DESIGNATE_ADMINISTRATORS" ? "designate" : "revoke",
              reason:
                error instanceof AdministratorManagementTransactionConflictError
                  ? "retry_exhausted"
                  : "transaction_error",
              type: "administrator_management_failed",
            })
          }
          await createSecurityAudit(transaction, {
            actorMembershipId: authorization.actorMembershipId,
            authorizationId: input.id,
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
          "The administrator authorization denial and its audits could not all be recorded.",
          { cause: auditError },
        )
      }
    }
    throw error instanceof AdministratorManagementTransactionConflictError
      ? new AdministratorManagementPersistenceError({ cause: error })
      : error
  }
}
