import { randomUUID } from "node:crypto"

import { Prisma } from "../../../generated/prisma/client.ts"
import type { PublicIdentityAttributes } from "../types.ts"
import { createAdmissionHandoff } from "../../../repositories/admission-handoffs/create-admission-handoff/index.ts"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider/index.ts"
import { getAuthenticationRevocationGeneration } from "../../../repositories/authentication-revocation-generations/get-authentication-revocation-generation/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { getSelectedProviderRevision } from "../../identity/get-selected-provider-revision/index.ts"
import { AuthenticationProofError } from "../errors.ts"

interface Database {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options: { isolationLevel: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

export async function createAuthenticationAdmissionHandoff(
  database: Database,
  input: {
    browserBindingDigest: string
    displayAttributes: PublicIdentityAttributes
    expiresAt: Date
    externalIdentityId: string
    providerKey: string
    providerRevisionId: string
    tokenDigest: string
  },
  createId: () => string = randomUUID,
): Promise<void> {
  await database.$transaction(
    async (transaction) => {
      const selectedRevision = await getSelectedProviderRevision(input.providerKey, {
        findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
      })
      if (selectedRevision?.id !== input.providerRevisionId) {
        throw new AuthenticationProofError(
          "configuration_changed",
          "The authentication provider configuration changed before handoff creation.",
        )
      }
      const handoffId = createId()
      await createAdmissionHandoff(transaction, {
        id: handoffId,
        externalIdentityId: input.externalIdentityId,
        providerRevisionId: input.providerRevisionId,
        tokenDigest: input.tokenDigest,
        browserBindingDigest: input.browserBindingDigest,
        revocationGeneration: await getAuthenticationRevocationGeneration(transaction),
        displayAttributes: input.displayAttributes,
        expiresAt: input.expiresAt,
      })
      await createSecurityAudit(transaction, {
        id: createId(),
        type: "authentication_handoff_created",
        handoffId,
        externalIdentityId: input.externalIdentityId,
        providerRevisionId: input.providerRevisionId,
      })
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
}
