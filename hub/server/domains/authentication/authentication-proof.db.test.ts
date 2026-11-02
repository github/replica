import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createAuthorizationAttempt } from "../../repositories/authorization-attempts/create-authorization-attempt"
import { consumeAuthorizationAttempt } from "../../repositories/authorization-attempts/consume-authorization-attempt"

describe("authentication proof database boundaries", () => {
  it("uses database time and consumes an authorization attempt exactly once", async () => {
    const providerId = randomUUID()
    const providerRevisionId = randomUUID()
    await prisma.$transaction(async (transaction) => {
      await transaction.authenticationProvider.create({
        data: { id: providerId, key: "github" },
      })
      await transaction.authenticationProviderRevision.create({
        data: {
          id: providerRevisionId,
          providerId,
          revision: 1,
          configurationDigest: "a".repeat(64),
        },
      })
      await transaction.authenticationProvider.update({
        where: { id: providerId },
        data: { selectedRevisionId: providerRevisionId },
      })
    })
    const input = {
      id: randomUUID(),
      providerRevisionId,
      stateDigest: "a".repeat(64),
      browserBindingDigest: "b".repeat(64),
      codeVerifierCiphertext: "encrypted-verifier",
      lifetimeSeconds: 600,
    }
    const { expiresAt } = await createAuthorizationAttempt(prisma, input)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())

    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: input.stateDigest,
        browserBindingDigest: "e".repeat(64),
      }),
    ).resolves.toBeNull()
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: input.stateDigest,
        browserBindingDigest: input.browserBindingDigest,
      }),
    ).resolves.toMatchObject({ providerRevisionId: input.providerRevisionId })
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: input.stateDigest,
        browserBindingDigest: input.browserBindingDigest,
      }),
    ).resolves.toBeNull()
  })

  it("adds only the authorization-attempt proof table", async () => {
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name NOT IN (
          '_prisma_migrations',
          'authentication_provider_revisions',
          'authentication_providers',
          'authorization_attempts',
          'external_identities',
          'security_audits',
          'users'
        )
    `
    expect(tables).toEqual([])
  })
})
