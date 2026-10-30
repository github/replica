import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createAdmissionHandoff } from "../../repositories/admission-handoffs/create-admission-handoff"
import { createAuthorizationAttempt } from "../../repositories/authorization-attempts/create-authorization-attempt"
import { consumeAuthorizationAttempt } from "../../repositories/authorization-attempts/consume-authorization-attempt"
import { incrementAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/increment-authentication-revocation-generation"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { hashAuthenticationValue } from "../../utils/authentication/hash-authentication-value"
import { resolveOrCreateExternalIdentity } from "../identity/resolve-or-create-external-identity"
import { runIdentityCreationTransaction } from "../identity/run-identity-creation-transaction"
import { runProviderRevisionTransaction } from "../identity/run-provider-revision-transaction"
import { validateAndPersistProviderRevision } from "../identity/validate-and-persist-provider-revision"
import { consumeAuthenticationAdmissionHandoff } from "./consume-admission-handoff"

async function createProvider(revision = 1) {
  const result = await validateAndPersistProviderRevision(
    {
      providerKey: "github",
      revision,
      configuration: { revision },
    },
    {
      createId: randomUUID,
      runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
      validateConfiguration: () =>
        Promise.resolve({
          canonicalPublicConfiguration: JSON.stringify({ revision }),
        }),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
  return result
}

async function createIdentity() {
  return resolveOrCreateExternalIdentity(
    { provider: "github", issuer: "https://github.com", subject: "123" },
    {
      createId: randomUUID,
      runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

describe("authentication proof database boundaries", () => {
  it("atomically consumes an authorization attempt once and rejects replay, expiry, and mismatch", async () => {
    const provider = await createProvider()
    const now = new Date()
    const base = {
      id: randomUUID(),
      providerRevisionId: provider.revisionId,
      stateDigest: "a".repeat(64),
      browserBindingDigest: "b".repeat(64),
      codeChallenge: "c".repeat(43),
      codeVerifierCiphertext: "encrypted-verifier",
      requestIpDigest: "d".repeat(64),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1_000),
    }
    await createAuthorizationAttempt(prisma, base)
    const consumedAt = new Date(Date.now() + 1_000)

    const [first, second] = await Promise.all([
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: base.browserBindingDigest,
        consumedAt,
      }),
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: base.browserBindingDigest,
        consumedAt,
      }),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: "e".repeat(64),
        consumedAt,
      }),
    ).resolves.toBeNull()

    await createAuthorizationAttempt(prisma, {
      ...base,
      id: randomUUID(),
      stateDigest: "f".repeat(64),
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: "f".repeat(64),
        browserBindingDigest: base.browserBindingDigest,
        consumedAt: new Date(now.getTime() + 2 * 60_000),
      }),
    ).resolves.toBeNull()
  })

  it("allows exactly one browser-bound handoff consumption and creates no session or membership", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
    const now = new Date()
    await createAdmissionHandoff(prisma, {
      id: randomUUID(),
      externalIdentityId: identity.externalIdentityId,
      providerRevisionId: provider.revisionId,
      tokenDigest: hashAuthenticationValue("handoff-token"),
      browserBindingDigest: hashAuthenticationValue("browser-binding"),
      revocationGeneration: 1n,
      displayAttributes: {
        login: "octocat",
        name: null,
        avatarUrl: null,
        email: null,
      },
      expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
    })

    const input = {
      handoffToken: "handoff-token",
      browserBinding: "browser-binding",
      providerKey: "github",
      now: new Date(Date.now() + 1_000),
    }
    const results = await Promise.all([
      consumeAuthenticationAdmissionHandoff(prisma, input),
      consumeAuthenticationAdmissionHandoff(prisma, input),
    ])
    expect(results.filter(({ status }) => status === "consumed")).toHaveLength(1)
    expect(results.filter(({ status }) => status === "denied")).toHaveLength(1)
    const applicationTables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%session%' OR table_name LIKE '%membership%')
    `
    expect(applicationTables).toEqual([])
  })

  it("denies handoffs after global revocation or provider revision drift", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
    const now = new Date()
    async function addHandoff(token: string, revocationGeneration: bigint) {
      await createAdmissionHandoff(prisma, {
        id: randomUUID(),
        externalIdentityId: identity.externalIdentityId,
        providerRevisionId: provider.revisionId,
        tokenDigest: hashAuthenticationValue(token),
        browserBindingDigest: hashAuthenticationValue("browser"),
        revocationGeneration,
        displayAttributes: {
          login: "octocat",
          name: null,
          avatarUrl: null,
          email: null,
        },
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
      })
    }

    await addHandoff("revoked", 1n)
    await incrementAuthenticationRevocationGeneration(prisma)
    await expect(
      consumeAuthenticationAdmissionHandoff(prisma, {
        handoffToken: "revoked",
        browserBinding: "browser",
        providerKey: "github",
        now,
      }),
    ).resolves.toEqual({ status: "denied", reason: "revoked" })

    await addHandoff("drifted", 2n)
    await createProvider(2)
    await expect(
      consumeAuthenticationAdmissionHandoff(prisma, {
        handoffToken: "drifted",
        browserBinding: "browser",
        providerKey: "github",
        now,
      }),
    ).resolves.toEqual({ status: "denied", reason: "provider_revision_changed" })
  })
})
