import { SecurityAuditOutcome } from "../../../generated/prisma/enums.ts"
import {
  IdentityTransactionConflictError,
  ProviderRevisionConflictError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionInvariantError,
  ProviderRevisionRollbackError,
} from "../errors.ts"
import { getSelectedProviderRevision } from "../get-selected-provider-revision/index.ts"
import type {
  PersistValidatedProviderRevisionDependencies,
  PersistValidatedProviderRevisionInput,
  PersistValidatedProviderRevisionResult,
} from "./types.ts"

function denialReason(error: unknown) {
  if (error instanceof ProviderRevisionRollbackError) return "rollback"
  if (error instanceof ProviderRevisionDriftError) return "same_revision_drift"
  if (error instanceof ProviderRevisionGapError) return "revision_gap"
  if (error instanceof ProviderRevisionInvariantError) return "invariant"
  return null
}

export async function persistValidatedProviderRevision(
  input: PersistValidatedProviderRevisionInput,
  dependencies: PersistValidatedProviderRevisionDependencies,
): Promise<PersistValidatedProviderRevisionResult> {
  const providerId = dependencies.createId()
  const revisionId = dependencies.createId()
  const successAuditId = dependencies.createId()

  try {
    return await dependencies.runTransaction(async (repositories) => {
      const current = await getSelectedProviderRevision(input.providerKey, repositories)
      let selectedProviderId = providerId

      if (current) {
        selectedProviderId = current.providerId
        if (input.revision < current.revision) throw new ProviderRevisionRollbackError()
        if (input.revision === current.revision) {
          if (input.configurationDigest !== current.configurationDigest) {
            throw new ProviderRevisionDriftError()
          }
          return {
            status: "unchanged",
            providerId: current.providerId,
            revisionId: current.id,
            revision: current.revision,
          }
        }
        if (input.revision !== current.revision + 1) throw new ProviderRevisionGapError()
      } else {
        if (input.revision !== 1) throw new ProviderRevisionGapError()
        await repositories.createAuthenticationProvider({
          id: providerId,
          key: input.providerKey,
        })
      }

      await repositories.createAuthenticationProviderRevision({
        id: revisionId,
        providerId: selectedProviderId,
        revision: input.revision,
        configurationDigest: input.configurationDigest,
        settings: input.settings,
      })
      await repositories.selectAuthenticationProviderRevision({
        providerId: selectedProviderId,
        revisionId,
      })
      await repositories.createSecurityAudit({
        id: successAuditId,
        action: "identity.provider_revision.selected",
        outcome: SecurityAuditOutcome.SUCCESS,
        targetType: "authentication_provider",
        targetId: selectedProviderId,
        context: { provider: input.providerKey, revision: input.revision },
      })

      return {
        status: "selected",
        providerId: selectedProviderId,
        revisionId,
        revision: input.revision,
      }
    })
  } catch (error) {
    const reason = denialReason(error)
    const conflict = error instanceof IdentityTransactionConflictError
    const auditError = conflict ? new ProviderRevisionConflictError({ cause: error }) : error
    try {
      await dependencies.writeAudit({
        id: dependencies.createId(),
        action: conflict
          ? "identity.provider_revision.persist_failed"
          : reason
            ? "identity.provider_revision.denied"
            : "identity.provider_revision.persist_failed",
        outcome: conflict || !reason ? SecurityAuditOutcome.FAILURE : SecurityAuditOutcome.DENIED,
        targetType: "authentication_provider",
        context: {
          provider: input.providerKey,
          revision: input.revision,
          reason: reason ?? (conflict ? "collision" : "transaction_error"),
        },
      })
    } catch (failureAuditError) {
      throw new AggregateError(
        [auditError, failureAuditError],
        "The provider revision rejection and its audit could not both be recorded.",
        { cause: failureAuditError },
      )
    }
    throw auditError
  }
}
