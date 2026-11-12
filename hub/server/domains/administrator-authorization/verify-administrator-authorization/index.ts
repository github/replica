import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import { applyProviderAssignmentEvidence } from "../../admission/apply-provider-assignment-evidence/index.ts"
import { AdmissionDeniedError, AdmissionTransactionConflictError } from "../../admission/errors.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import type { AdministratorAuthorizationVerificationTransaction } from "../run-administrator-authorization-verification-transaction/types.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"

const inputSchema = z
  .object({
    authorizationAttemptId: z.uuid(),
    externalIdentityId: z.uuid(),
    providerAssignment: z
      .object({
        assignmentSubject: z.string().min(1).max(100).nullable(),
        issuedAt: z.date(),
        providerRevisionId: z.uuid(),
        role: z.enum(["MEMBER", "ADMINISTRATOR"]).nullable(),
      })
      .strict()
      .optional(),
    providerKey: z.unknown(),
    requiresProviderAssignmentEvidence: z.boolean(),
    sessionDigest: z.string().regex(/^[0-9a-f]{64}$/),
    sensitiveAuthorizationId: z.uuid(),
  })
  .strict()

export async function verifyAdministratorAuthorization(
  rawInput: unknown,
  dependencies: {
    createId(): string
    getAuthorizationAuditData(id: string): Promise<{
      actorMembershipId: string
      expired: boolean
      operation: "DESIGNATE_ADMINISTRATORS" | "REVOKE_ADMINISTRATOR"
      targetCount: number
    } | null>
    runTransaction: AdministratorAuthorizationVerificationTransaction
    writeAudit(event: CreateSecurityAuditEvent): Promise<unknown>
  },
): Promise<boolean> {
  const parsed = inputSchema.parse(rawInput)
  const input = {
    ...parsed,
    providerKey: parseProviderKey(parsed.providerKey),
  }
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction(async (repositories) => {
          const provider = await repositories.lockProvider(input.providerKey)
          const revocation = await repositories.lockRevocation()
          const attempt = await repositories.lockAttempt(input.authorizationAttemptId)
          const identity = await repositories.getExternalIdentity(input.externalIdentityId)
          if (
            !provider?.enabled ||
            !revocation ||
            !attempt?.consumedAt ||
            attempt.purpose !== "ADMINISTRATOR_MANAGEMENT" ||
            provider.selectedRevisionId !== attempt.providerRevisionId ||
            revocation.revision !== attempt.sessionRevocationRevision
          ) {
            throw new AdmissionDeniedError("attempt_mismatch", input.externalIdentityId)
          }
          if (!identity || identity.provider !== input.providerKey) {
            throw new AdmissionDeniedError("identity_mismatch", input.externalIdentityId)
          }
          if (input.requiresProviderAssignmentEvidence && !input.providerAssignment) {
            throw new AdmissionDeniedError("provider_evidence_missing", input.externalIdentityId)
          }
          if (input.providerAssignment) {
            if (input.providerAssignment.providerRevisionId !== attempt.providerRevisionId) {
              throw new AdmissionDeniedError("configuration_changed", input.externalIdentityId)
            }
            const claim = await repositories.claimProviderEvidence({
              externalIdentityId: input.externalIdentityId,
              id: dependencies.createId(),
              issuedAt: input.providerAssignment.issuedAt,
              role: input.providerAssignment.role,
            })
            if (claim === "conflict") throw new AdmissionTransactionConflictError()
            if (claim === "stale") {
              throw new AdmissionDeniedError("provider_evidence_stale", input.externalIdentityId)
            }
            const applied = await applyProviderAssignmentEvidence(
              {
                assignmentSubject: input.providerAssignment.assignmentSubject,
                externalIdentityId: input.externalIdentityId,
                providerRevisionId: input.providerAssignment.providerRevisionId,
                role: input.providerAssignment.role,
                userId: identity.userId,
              },
              { createId: () => dependencies.createId(), repositories },
            )
            if (applied.denied) {
              const authorization = await repositories.getSensitiveAuthorizationAuditData(
                input.sensitiveAuthorizationId,
              )
              if (authorization) {
                await repositories.createSecurityAudit({
                  actorMembershipId: authorization.actorMembershipId,
                  authorizationId: input.sensitiveAuthorizationId,
                  id: dependencies.createId(),
                  operation: authorization.operation,
                  phase: "denied",
                  reason: applied.reason,
                  targetCount: authorization.targetCount,
                  type: "administrator_authorization",
                })
              }
              return false
            }
          }
          const verified = await repositories.verifySensitiveAuthorization({
            authorizationAttemptId: input.authorizationAttemptId,
            externalIdentityId: input.externalIdentityId,
            sessionDigest: input.sessionDigest,
            sensitiveAuthorizationId: input.sensitiveAuthorizationId,
          })
          if (!verified) {
            const authorization = await repositories.getSensitiveAuthorizationAuditData(
              input.sensitiveAuthorizationId,
            )
            if (authorization) {
              await repositories.createSecurityAudit({
                actorMembershipId: authorization.actorMembershipId,
                authorizationId: input.sensitiveAuthorizationId,
                id: dependencies.createId(),
                operation: authorization.operation,
                phase: authorization.expired ? "expired" : "denied",
                reason: "verification_rejected",
                targetCount: authorization.targetCount,
                type: "administrator_authorization",
              })
            }
            return false
          }
          await repositories.createSecurityAudit({
            actorMembershipId: verified.actorMembershipId,
            authorizationId: verified.id,
            id: dependencies.createId(),
            operation: verified.operation,
            phase: "verified",
            targetCount: verified.targetCount,
            type: "administrator_authorization",
          })
          return true
        }),
      (error) => error instanceof AdmissionTransactionConflictError,
    )
  } catch (error) {
    const reason =
      error instanceof AdmissionDeniedError
        ? error.reason
        : error instanceof AdmissionTransactionConflictError
          ? "retry_exhausted"
          : null
    if (reason) {
      const authorization = await dependencies.getAuthorizationAuditData(
        input.sensitiveAuthorizationId,
      )
      if (authorization) {
        try {
          await dependencies.writeAudit({
            actorMembershipId: authorization.actorMembershipId,
            authorizationId: input.sensitiveAuthorizationId,
            id: dependencies.createId(),
            operation: authorization.operation,
            phase: authorization.expired ? "expired" : "denied",
            reason,
            targetCount: authorization.targetCount,
            type: "administrator_authorization",
          })
        } catch (auditError) {
          throw new AggregateError(
            [error, auditError],
            "The administrator authorization denial and its audit could not both be recorded.",
            { cause: auditError },
          )
        }
      }
    }
    throw error
  }
}
