import { randomUUID } from "node:crypto"
import { z } from "zod"

import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { IdentityTransactionConflictError } from "../../identity/errors.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import { AuthenticationProofError } from "../errors.ts"
import { recordAuthenticationDenial } from "../record-authentication-denial/index.ts"
import type { AdmissionHandoffTransaction } from "../run-admission-handoff-transaction/types.ts"
import type { PublicIdentityAttributes } from "../types.ts"

type DenialReason =
  "browser_mismatch" | "expired" | "provider_revision_changed" | "replayed" | "revoked"

export type ConsumeAdmissionHandoffResult =
  | {
      status: "consumed"
      externalIdentityId: string
      attributes: PublicIdentityAttributes
    }
  | { status: "denied"; reason: DenialReason }

const attributesSchema = z
  .object({
    avatarUrl: z.url().max(2_000).nullable(),
    email: z.email().max(320).nullable(),
    login: z.string().min(1).max(100),
    name: z.string().min(1).max(200).nullable(),
  })
  .strict()

export function consumeAuthenticationAdmissionHandoff(
  input: {
    browserBinding: string
    handoffToken: string
    providerKey: string
  },
  dependencies: {
    createId?: () => string
    runTransaction: AdmissionHandoffTransaction
  },
): Promise<ConsumeAdmissionHandoffResult> {
  const createId = dependencies.createId ?? randomUUID
  const tokenDigest = hashAuthenticationValue(input.handoffToken)
  const browserBindingDigest = hashAuthenticationValue(input.browserBinding)

  return runWithBoundedRetries(
    () =>
      dependencies.runTransaction(async (repositories) => {
        const handoff = await repositories.findAdmissionHandoff(tokenDigest)
        let reason: DenialReason | null = null
        if (!handoff || handoff.consumedAt) reason = "replayed"
        else {
          await repositories.lockAuthenticationProviderSelection(input.providerKey)
          await repositories.lockAuthenticationRevocationGeneration()
          const selectedRevision = await getSelectedProviderRevision(
            input.providerKey,
            repositories,
          )
          if (selectedRevision?.id !== handoff.providerRevisionId) {
            reason = "provider_revision_changed"
          } else if (
            handoff.revocationGeneration !==
            (await repositories.getAuthenticationRevocationGeneration())
          ) {
            reason = "revoked"
          }
        }

        if (reason) {
          const deniedReason = reason
          await recordAuthenticationDenial(
            new AuthenticationProofError("attempt_invalid", "The admission handoff was denied."),
            () =>
              repositories.createSecurityAudit({
                id: createId(),
                type: "authentication_handoff_denied",
                ...(handoff ? { handoffId: handoff.id } : {}),
                reason: deniedReason,
              }),
          )
          return { status: "denied", reason: deniedReason }
        }

        const consumption = await repositories.consumeAdmissionHandoff({
          id: handoff!.id,
          browserBindingDigest,
        })
        if (consumption !== "consumed") {
          const deniedReason = consumption
          await recordAuthenticationDenial(
            new AuthenticationProofError("attempt_invalid", "The admission handoff was denied."),
            () =>
              repositories.createSecurityAudit({
                id: createId(),
                type: "authentication_handoff_denied",
                handoffId: handoff!.id,
                reason: deniedReason,
              }),
          )
          return { status: "denied", reason: deniedReason }
        }
        await repositories.createSecurityAudit({
          id: createId(),
          type: "authentication_handoff_consumed",
          handoffId: handoff!.id,
          externalIdentityId: handoff!.externalIdentityId,
        })
        return {
          status: "consumed",
          externalIdentityId: handoff!.externalIdentityId,
          attributes: attributesSchema.parse(handoff!.displayAttributes),
        }
      }),
    (error) => error instanceof IdentityTransactionConflictError,
  )
}
