import { randomUUID } from "node:crypto"

import { Prisma } from "../../../generated/prisma/client.ts"
import { z } from "zod"

import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { getAuthenticationRevocationGeneration } from "../../../repositories/authentication-revocation-generations/get-authentication-revocation-generation/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { hashAuthenticationValue } from "../../../utils/authentication/hash-authentication-value/index.ts"
import { IdentityTransactionConflictError } from "../../identity/errors.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import type { PublicIdentityAttributes } from "../types.ts"

type DenialReason =
  "browser_mismatch" | "expired" | "provider_revision_changed" | "replayed" | "revoked"

interface Database {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

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

export async function consumeAuthenticationAdmissionHandoff(
  database: Database,
  input: {
    browserBinding: string
    handoffToken: string
    now: Date
    providerKey: string
  },
  createId: () => string = randomUUID,
): Promise<ConsumeAdmissionHandoffResult> {
  const tokenDigest = hashAuthenticationValue(input.handoffToken)
  const browserBindingDigest = hashAuthenticationValue(input.browserBinding)

  return runWithBoundedRetries(
    () =>
      database
        .$transaction(
          async (transaction): Promise<ConsumeAdmissionHandoffResult> => {
            const handoff = await transaction.admissionHandoff.findUnique({
              where: { tokenDigest },
            })
            let reason: DenialReason | null = null
            if (!handoff || handoff.consumedAt) reason = "replayed"
            else if (handoff.expiresAt <= input.now) reason = "expired"
            else if (handoff.browserBindingDigest !== browserBindingDigest)
              reason = "browser_mismatch"
            else if (
              handoff.revocationGeneration !==
              (await getAuthenticationRevocationGeneration(transaction))
            ) {
              reason = "revoked"
            } else {
              const selectedRevision = await getSelectedProviderRevision(input.providerKey, {
                findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
              })
              if (selectedRevision?.id !== handoff.providerRevisionId) {
                reason = "provider_revision_changed"
              }
            }

            if (reason) {
              await createSecurityAudit(transaction, {
                id: createId(),
                type: "authentication_handoff_denied",
                ...(handoff ? { handoffId: handoff.id } : {}),
                reason,
              })
              return { status: "denied", reason }
            }

            const consumed = await transaction.admissionHandoff.updateMany({
              where: { id: handoff!.id, consumedAt: null },
              data: { consumedAt: input.now },
            })
            if (consumed.count !== 1) {
              await createSecurityAudit(transaction, {
                id: createId(),
                type: "authentication_handoff_denied",
                handoffId: handoff!.id,
                reason: "replayed",
              })
              return { status: "denied", reason: "replayed" }
            }
            await createSecurityAudit(transaction, {
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
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
            throw new IdentityTransactionConflictError({ cause: error })
          }
          throw error
        }),
    (error) => error instanceof IdentityTransactionConflictError,
  )
}
