import { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"
import { ExternalIdentityCollisionError, IdentityTransactionConflictError } from "../errors.ts"
import { resolveExternalIdentity } from "../resolve-external-identity/index.ts"
import type {
  ResolveOrCreateExternalIdentityDependencies,
  ResolveOrCreateExternalIdentityInput,
  ResolveOrCreateExternalIdentityResult,
} from "./types.ts"

export async function resolveOrCreateExternalIdentity(
  input: ResolveOrCreateExternalIdentityInput,
  dependencies: ResolveOrCreateExternalIdentityDependencies,
): Promise<ResolveOrCreateExternalIdentityResult> {
  const userId = dependencies.createId()
  const externalIdentityId = dependencies.createId()
  const successAuditId = dependencies.createId()

  try {
    return await dependencies.runTransaction(async (repositories) => {
      const existing = await resolveExternalIdentity(input, repositories)
      if (existing.status === "found") {
        return { ...existing, status: "found" }
      }

      await repositories.createUser({ id: userId })
      await repositories.createExternalIdentity({ id: externalIdentityId, userId, ...input })
      await repositories.createSecurityAudit({
        id: successAuditId,
        action: "identity.external.created",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "external_identity",
        targetId: externalIdentityId,
        context: { provider: input.provider, issuer: input.issuer },
      })

      return { status: "created", externalIdentityId, userId }
    })
  } catch (error) {
    const failure =
      error instanceof IdentityTransactionConflictError
        ? new ExternalIdentityCollisionError({ cause: error })
        : error
    try {
      await dependencies.writeAudit({
        id: dependencies.createId(),
        action: "identity.external.create_failed",
        outcome: SecurityAuditOutcome.FAILURE,
        targetType: "external_identity",
        context: {
          provider: input.provider,
          issuer: input.issuer,
          reason:
            error instanceof IdentityTransactionConflictError ? "collision" : "transaction_error",
        },
      })
    } catch (auditError) {
      throw new AggregateError(
        [failure, auditError],
        "The external identity failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw failure
  }
}
