import { createHash } from "node:crypto"
import { z } from "zod"

import { parseProviderKey } from "../../../utils/parse-provider-key/index.ts"
import {
  IdentityTransactionConflictError,
  ProviderReactivationRevisionError,
  ProviderRevisionConflictError,
  ProviderRevisionDeniedError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionInvariantError,
  ProviderRevisionRollbackError,
} from "../errors.ts"
import { runWithBoundedRetries } from "../run-with-bounded-retries/index.ts"
import type {
  ReconcileAuthenticationProviderCandidate,
  ReconcileAuthenticationProvidersDependencies,
  ReconciledAuthenticationProvider,
} from "./types.ts"

const candidateSchema = z
  .object({
    canonicalPublicConfiguration: z.string().min(1).max(16_384),
    providerKey: z.unknown(),
    revision: z.number().int().positive(),
  })
  .strict()

export async function reconcileAuthenticationProviders(
  candidates: ReconcileAuthenticationProviderCandidate[],
  dependencies: ReconcileAuthenticationProvidersDependencies,
): Promise<ReconciledAuthenticationProvider[]> {
  const parsed = candidates
    .map((candidate) => {
      const value = candidateSchema.parse(candidate)
      return {
        ...value,
        configurationDigest: createHash("sha256")
          .update(value.canonicalPublicConfiguration)
          .digest("hex"),
        providerKey: parseProviderKey(value.providerKey),
      }
    })
    .sort((left, right) => left.providerKey.localeCompare(right.providerKey))
  if (new Set(parsed.map((candidate) => candidate.providerKey)).size !== parsed.length) {
    throw new Error("Authentication provider candidates must have unique provider keys.")
  }
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction(async (repositories) => {
          const existing = await repositories.lockAuthenticationProviders()
          const existingByKey = new Map(existing.map((provider) => [provider.key, provider]))
          const configuredKeys = new Set<string>(parsed.map((candidate) => candidate.providerKey))
          const result: ReconciledAuthenticationProvider[] = []

          for (const candidate of parsed) {
            const current = existingByKey.get(candidate.providerKey)
            let providerId: string
            let revisionId: string
            if (current) {
              providerId = current.id
              revisionId = current.revisionId
              if (candidate.revision < current.revision) {
                throw new ProviderRevisionRollbackError(candidate.providerKey, candidate.revision)
              }
              if (candidate.revision === current.revision) {
                if (candidate.configurationDigest !== current.configurationDigest) {
                  throw new ProviderRevisionDriftError(candidate.providerKey, candidate.revision)
                }
                if (!current.enabled) {
                  throw new ProviderReactivationRevisionError(
                    candidate.providerKey,
                    candidate.revision,
                  )
                }
              } else {
                if (candidate.revision !== current.revision + 1) {
                  throw new ProviderRevisionGapError(candidate.providerKey, candidate.revision)
                }
                revisionId = dependencies.createId()
                await repositories.createAuthenticationProviderRevision({
                  id: revisionId,
                  providerId,
                  revision: candidate.revision,
                  configurationDigest: candidate.configurationDigest,
                })
                if (current.enabled) {
                  await repositories.selectAuthenticationProviderRevision({
                    providerId,
                    revisionId,
                  })
                }
                await repositories.createSecurityAudit({
                  id: dependencies.createId(),
                  type: "provider_revision_selected",
                  providerId,
                  providerKey: candidate.providerKey,
                  revision: candidate.revision,
                })
              }
              if (!current.enabled) {
                await repositories.enableAuthenticationProvider({
                  providerId,
                  revisionId,
                })
                await repositories.createSecurityAudit({
                  id: dependencies.createId(),
                  type: "authentication_provider_enabled",
                  providerId,
                  providerKey: candidate.providerKey,
                })
              }
            } else {
              if (candidate.revision !== 1) {
                throw new ProviderRevisionGapError(candidate.providerKey, candidate.revision)
              }
              providerId = dependencies.createId()
              revisionId = dependencies.createId()
              await repositories.createAuthenticationProvider({
                id: providerId,
                key: candidate.providerKey,
              })
              await repositories.createAuthenticationProviderRevision({
                id: revisionId,
                providerId,
                revision: candidate.revision,
                configurationDigest: candidate.configurationDigest,
              })
              await repositories.selectAuthenticationProviderRevision({
                providerId,
                revisionId,
              })
              await repositories.createSecurityAudit({
                id: dependencies.createId(),
                type: "provider_revision_selected",
                providerId,
                providerKey: candidate.providerKey,
                revision: candidate.revision,
              })
            }
            result.push({
              providerId,
              providerKey: candidate.providerKey,
              revision: candidate.revision,
              revisionId,
            })
          }

          const removed = existing.filter(
            (provider) => provider.enabled && !configuredKeys.has(provider.key),
          )
          if (removed.length) {
            const revocation = await repositories.incrementSessionRevocation()
            if (!revocation) {
              throw new ProviderRevisionInvariantError(
                "The global session revocation authority is unavailable.",
              )
            }
            await repositories.createSecurityAudit({
              id: dependencies.createId(),
              type: "session_revocation_advanced",
              reason: "provider_removed",
              revision: revocation.revision,
            })
            for (const provider of removed) {
              await repositories.disableAuthenticationProvider(provider.id)
              await repositories.createSecurityAudit({
                id: dependencies.createId(),
                type: "authentication_provider_disabled",
                providerId: provider.id,
                providerKey: provider.key,
              })
            }
          }
          const disconnected =
            await repositories.disconnectCopilotConnectionWithoutEffectiveAdministrator()
          if (disconnected) {
            await repositories.createSecurityAudit({
              actorMembershipId: null,
              connectorMembershipId: disconnected.membershipId,
              id: dependencies.createId(),
              operation: "disconnect",
              outcome: "success",
              reason: "connector_role_removed",
              type: "copilot_connection",
            })
          }
          return result
        }),
      (error) => error instanceof IdentityTransactionConflictError,
    )
  } catch (error) {
    const conflict = error instanceof IdentityTransactionConflictError
    const reported = conflict ? new ProviderRevisionConflictError({ cause: error }) : error
    try {
      await dependencies.writeAudit(
        error instanceof ProviderRevisionDeniedError
          ? {
              id: dependencies.createId(),
              type: "provider_revision_denied",
              providerKey: error.providerKey,
              reason: error.auditReason,
              revision: error.revision,
            }
          : {
              id: dependencies.createId(),
              type: "authentication_providers_reconcile_failed",
              providerKeys: parsed.map((candidate) => candidate.providerKey),
              reason: conflict ? "retry_exhausted" : "transaction_error",
            },
      )
    } catch (auditError) {
      throw new AggregateError(
        [reported, auditError],
        "Authentication provider reconciliation and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw reported
  }
}
