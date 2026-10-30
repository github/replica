import { randomUUID } from "node:crypto"

import { IdentityTransactionConflictError } from "../../identity/errors.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import type { PublicIdentityAttributes } from "../types.ts"
import type { AdmissionHandoffTransaction } from "../run-admission-handoff-transaction/types.ts"

export type CreateAuthenticationAdmissionHandoffResult =
  | { status: "created" }
  | {
      status: "restart"
      reason: "conflict" | "provider_revision_changed" | "revoked"
    }

export function createAuthenticationAdmissionHandoff(
  input: {
    browserBindingDigest: string
    displayAttributes: PublicIdentityAttributes
    expectedRevocationGeneration: bigint
    expiresAt: Date
    externalIdentityId: string
    providerKey: string
    providerRevisionId: string
    tokenDigest: string
  },
  dependencies: {
    createId?: () => string
    runTransaction: AdmissionHandoffTransaction
  },
): Promise<CreateAuthenticationAdmissionHandoffResult> {
  const createId = dependencies.createId ?? randomUUID
  return runWithBoundedRetries(
    () =>
      dependencies.runTransaction(async (repositories) => {
        // Every handoff operation locks provider selection before global revocation.
        await repositories.lockAuthenticationProviderSelection(input.providerKey)
        await repositories.lockAuthenticationRevocationGeneration()
        const selectedRevision = await getSelectedProviderRevision(input.providerKey, repositories)
        if (selectedRevision?.id !== input.providerRevisionId) {
          return { status: "restart", reason: "provider_revision_changed" } as const
        }
        const revocationGeneration = await repositories.getAuthenticationRevocationGeneration()
        if (revocationGeneration !== input.expectedRevocationGeneration) {
          return { status: "restart", reason: "revoked" } as const
        }

        const handoffId = createId()
        await repositories.createAdmissionHandoff({
          id: handoffId,
          externalIdentityId: input.externalIdentityId,
          providerRevisionId: input.providerRevisionId,
          tokenDigest: input.tokenDigest,
          browserBindingDigest: input.browserBindingDigest,
          revocationGeneration,
          displayAttributes: input.displayAttributes,
          expiresAt: input.expiresAt,
        })
        await repositories.createSecurityAudit({
          id: createId(),
          type: "authentication_handoff_created",
          handoffId,
          externalIdentityId: input.externalIdentityId,
          providerRevisionId: input.providerRevisionId,
        })
        return { status: "created" } as const
      }),
    (error) => error instanceof IdentityTransactionConflictError,
  ).catch((error: unknown) => {
    if (error instanceof IdentityTransactionConflictError) {
      return { status: "restart", reason: "conflict" }
    }
    throw error
  })
}
