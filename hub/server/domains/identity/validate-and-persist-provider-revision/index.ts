import { createHash } from "node:crypto"
import { z } from "zod"

import {
  IdentityTransactionConflictError,
  ProviderConfigurationValidationError,
  ProviderRevisionConflictError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionInvariantError,
  ProviderRevisionRollbackError,
} from "../errors.ts"
import { getSelectedProviderRevision } from "../get-selected-provider-revision/index.ts"
import { runWithBoundedRetries } from "../run-with-bounded-retries/index.ts"
import type {
  ValidateAndPersistProviderRevisionDependencies,
  ValidateAndPersistProviderRevisionInput,
  ValidateAndPersistProviderRevisionResult,
} from "./types.ts"

const providerRevisionSchema = z
  .object({
    providerKey: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/),
    revision: z.number().int().positive(),
    configuration: z.unknown(),
  })
  .strict()

function denialReason(error: unknown) {
  if (error instanceof ProviderRevisionRollbackError) return "rollback" as const
  if (error instanceof ProviderRevisionDriftError) return "same_revision_drift" as const
  if (error instanceof ProviderRevisionGapError) return "revision_gap" as const
  if (error instanceof ProviderRevisionInvariantError) return "invariant" as const
  return null
}

export async function validateAndPersistProviderRevision<Candidate>(
  input: ValidateAndPersistProviderRevisionInput<Candidate>,
  dependencies: ValidateAndPersistProviderRevisionDependencies<Candidate>,
): Promise<ValidateAndPersistProviderRevisionResult> {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error("Provider revision input must be a plain object.")
  }
  const parsed = providerRevisionSchema.parse(input)
  let canonicalPublicConfiguration: string
  try {
    const validated = await dependencies.validateConfiguration(input.configuration)
    if (
      typeof validated.canonicalPublicConfiguration !== "string" ||
      !validated.canonicalPublicConfiguration.length ||
      validated.canonicalPublicConfiguration.length > 16_384
    ) {
      throw new Error(
        "Provider validation must return canonical public configuration between 1 and 16384 characters.",
      )
    }
    canonicalPublicConfiguration = validated.canonicalPublicConfiguration
  } catch (error) {
    const reportedError = new ProviderConfigurationValidationError({ cause: error })
    try {
      await dependencies.writeAudit({
        id: dependencies.createId(),
        type: "provider_revision_validation_failed",
        providerKey: parsed.providerKey,
        revision: parsed.revision,
      })
    } catch (auditError) {
      throw new AggregateError(
        [reportedError, auditError],
        "The provider validation failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw reportedError
  }
  const configurationDigest = createHash("sha256")
    .update(canonicalPublicConfiguration)
    .digest("hex")

  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction(async (repositories) => {
          const current = await getSelectedProviderRevision(parsed.providerKey, repositories)
          let providerId: string

          if (current) {
            providerId = current.providerId
            if (parsed.revision < current.revision) throw new ProviderRevisionRollbackError()
            if (parsed.revision === current.revision) {
              if (configurationDigest !== current.configurationDigest) {
                throw new ProviderRevisionDriftError()
              }
              return {
                status: "unchanged",
                providerId: current.providerId,
                revisionId: current.id,
                revision: current.revision,
              }
            }
            if (parsed.revision !== current.revision + 1) throw new ProviderRevisionGapError()
          } else {
            if (parsed.revision !== 1) throw new ProviderRevisionGapError()
            providerId = dependencies.createId()
            await repositories.createAuthenticationProvider({
              id: providerId,
              key: parsed.providerKey,
            })
          }

          const revisionId = dependencies.createId()
          await repositories.createAuthenticationProviderRevision({
            id: revisionId,
            providerId,
            revision: parsed.revision,
            configurationDigest,
          })
          await repositories.selectAuthenticationProviderRevision({ providerId, revisionId })
          await repositories.createSecurityAudit({
            id: dependencies.createId(),
            type: "provider_revision_selected",
            providerId,
            providerKey: parsed.providerKey,
            revision: parsed.revision,
          })

          return { status: "selected", providerId, revisionId, revision: parsed.revision }
        }),
      (error) => error instanceof IdentityTransactionConflictError,
    )
  } catch (error) {
    const reason = denialReason(error)
    const conflict = error instanceof IdentityTransactionConflictError
    const reportedError = conflict ? new ProviderRevisionConflictError({ cause: error }) : error
    try {
      await dependencies.writeAudit(
        reason
          ? {
              id: dependencies.createId(),
              type: "provider_revision_denied",
              providerKey: parsed.providerKey,
              revision: parsed.revision,
              reason,
            }
          : {
              id: dependencies.createId(),
              type: "provider_revision_persist_failed",
              providerKey: parsed.providerKey,
              revision: parsed.revision,
              reason: conflict ? "retry_exhausted" : "transaction_error",
            },
      )
    } catch (failureAuditError) {
      throw new AggregateError(
        [reportedError, failureAuditError],
        "The provider revision rejection and its audit could not both be recorded.",
        { cause: failureAuditError },
      )
    }
    throw reportedError
  }
}
