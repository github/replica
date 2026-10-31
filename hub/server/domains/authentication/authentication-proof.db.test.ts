import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { createAdmissionHandoff } from "../../repositories/admission-handoffs/create-admission-handoff"
import { deleteExpiredAdmissionHandoffs } from "../../repositories/admission-handoffs/delete-expired-admission-handoffs"
import { createAuthorizationAttempt } from "../../repositories/authorization-attempts/create-authorization-attempt"
import { deleteExpiredAuthorizationAttempts } from "../../repositories/authorization-attempts/delete-expired-authorization-attempts"
import { consumeAuthorizationAttempt } from "../../repositories/authorization-attempts/consume-authorization-attempt"
import { lockAuthenticationProviderSelection } from "../../repositories/authentication-providers/lock-authentication-provider-selection"
import { incrementAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/increment-authentication-revocation-generation"
import { lockAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/lock-authentication-revocation-generation"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { hashAuthenticationValue } from "../../utils/authentication/hash-authentication-value"
import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { waitForDatabaseLock } from "../../../test/database/wait-for-database-lock"
import { resolveOrCreateExternalIdentity } from "../identity/resolve-or-create-external-identity"
import { runIdentityCreationTransaction } from "../identity/run-identity-creation-transaction"
import { runProviderRevisionTransaction } from "../identity/run-provider-revision-transaction"
import { validateAndPersistProviderRevision } from "../identity/validate-and-persist-provider-revision"
import { consumeAuthenticationAdmissionHandoff } from "./consume-admission-handoff"
import { createAuthenticationAdmissionHandoff } from "./create-admission-handoff"
import { runAdmissionHandoffTransaction } from "./run-admission-handoff-transaction"

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
    const base = {
      id: randomUUID(),
      providerRevisionId: provider.revisionId,
      stateDigest: "a".repeat(64),
      browserBindingDigest: "b".repeat(64),
      codeChallenge: "c".repeat(43),
      codeVerifierCiphertext: "encrypted-verifier",
      requestIpDigest: "d".repeat(64),
      lifetimeSeconds: 600,
    }
    await createAuthorizationAttempt(prisma, base)
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: "e".repeat(64),
      }),
    ).resolves.toBeNull()

    const [first, second] = await Promise.all([
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: base.browserBindingDigest,
      }),
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: base.browserBindingDigest,
      }),
    ])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: base.stateDigest,
        browserBindingDigest: base.browserBindingDigest,
      }),
    ).resolves.toBeNull()

    await prisma.$executeRaw`
      INSERT INTO "authorization_attempts" (
        "id", "provider_revision_id", "state_digest", "browser_binding_digest",
        "code_challenge", "code_verifier_ciphertext", "request_ip_digest",
        "expires_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${provider.revisionId}::uuid, ${"f".repeat(64)},
        ${base.browserBindingDigest}, ${base.codeChallenge}, ${base.codeVerifierCiphertext},
        ${base.requestIpDigest}, clock_timestamp() - interval '1 millisecond',
        clock_timestamp() - interval '1 second', clock_timestamp()
      )
    `
    await expect(
      consumeAuthorizationAttempt(prisma, {
        stateDigest: "f".repeat(64),
        browserBindingDigest: base.browserBindingDigest,
      }),
    ).resolves.toBeNull()
  })

  it("denies an authorization attempt that expires while waiting on its row lock", async () => {
    const provider = await createProvider()
    const stateDigest = "9".repeat(64)
    await prisma.$executeRaw`
      INSERT INTO "authorization_attempts" (
        "id", "provider_revision_id", "state_digest", "browser_binding_digest",
        "code_challenge", "code_verifier_ciphertext", "request_ip_digest",
        "expires_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${provider.revisionId}::uuid, ${stateDigest},
        ${"b".repeat(64)}, ${"c".repeat(43)}, 'encrypted', ${"d".repeat(64)},
        clock_timestamp() + interval '10 milliseconds',
        clock_timestamp(), clock_timestamp()
      )
    `
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let locked!: () => void
    const acquired = new Promise<void>((resolve) => {
      locked = resolve
    })
    const holder = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "authorization_attempts"
        WHERE "state_digest" = ${stateDigest}
        FOR UPDATE
      `
      locked()
      await waiting
    })
    await acquired
    const consumption = consumeAuthorizationAttempt(prisma, {
      stateDigest,
      browserBindingDigest: "b".repeat(64),
    })
    await waitForDatabaseLock(getDatabaseUrl())
    await prisma.$executeRaw`SELECT pg_sleep(0.02)`
    release()
    await holder

    await expect(consumption).resolves.toBeNull()
  })

  it("allows exactly one browser-bound handoff consumption and creates no session or membership", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
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
      lifetimeSeconds: 300,
    })

    const input = {
      handoffToken: "handoff-token",
      browserBinding: "browser-binding",
      providerKey: "github",
    }
    const results = await Promise.all([
      consumeAuthenticationAdmissionHandoff(input, {
        runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
      }),
      consumeAuthenticationAdmissionHandoff(input, {
        runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
      }),
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

  it("uses database time for expired, boundary, and lock-wait consumption", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
    async function insertHandoff(token: string, expiryExpression: string) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "admission_handoffs" (
          "id", "external_identity_id", "provider_revision_id", "token_digest",
          "browser_binding_digest", "revocation_generation", "display_attributes",
          "expires_at", "created_at", "updated_at"
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, 1, '{"login":"octocat"}'::jsonb,
          ${expiryExpression}, clock_timestamp() - interval '1 second', clock_timestamp()
        )`,
        randomUUID(),
        identity.externalIdentityId,
        provider.revisionId,
        hashAuthenticationValue(token),
        hashAuthenticationValue("browser"),
      )
    }
    async function consume(token: string, runTransaction = runAdmissionHandoffTransaction) {
      return consumeAuthenticationAdmissionHandoff(
        { handoffToken: token, browserBinding: "browser", providerKey: "github" },
        { runTransaction: (operation) => runTransaction(prisma, operation) },
      )
    }

    await insertHandoff("already-expired", "clock_timestamp() - interval '1 millisecond'")
    await expect(consume("already-expired")).resolves.toEqual({
      status: "denied",
      reason: "expired",
    })

    await insertHandoff("boundary", "clock_timestamp()")
    await expect(consume("boundary")).resolves.toEqual({
      status: "denied",
      reason: "expired",
    })

    await insertHandoff("expires-during-wait", "clock_timestamp() + interval '5 milliseconds'")
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let arrived!: () => void
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve
    })
    const consumption = consume("expires-during-wait", (database, operation) =>
      runAdmissionHandoffTransaction(database, operation, {
        lockProvider: async (transaction, providerKey) => {
          await lockAuthenticationProviderSelection(transaction, providerKey)
          arrived()
          await waiting
        },
        lockRevocation: lockAuthenticationRevocationGeneration,
      }),
    )
    await arrival
    await prisma.$executeRaw`SELECT pg_sleep(0.02)`
    release()
    await expect(consumption).resolves.toEqual({ status: "denied", reason: "expired" })
  })

  it("denies handoffs after global revocation or provider revision drift", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
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
        lifetimeSeconds: 300,
      })
    }

    await addHandoff("revoked", 1n)
    await incrementAuthenticationRevocationGeneration(prisma)
    await expect(
      consumeAuthenticationAdmissionHandoff(
        {
          handoffToken: "revoked",
          browserBinding: "browser",
          providerKey: "github",
        },
        { runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation) },
      ),
    ).resolves.toEqual({ status: "denied", reason: "revoked" })

    await addHandoff("drifted", 2n)
    await createProvider(2)
    await expect(
      consumeAuthenticationAdmissionHandoff(
        {
          handoffToken: "drifted",
          browserBinding: "browser",
          providerKey: "github",
        },
        { runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation) },
      ),
    ).resolves.toEqual({ status: "denied", reason: "provider_revision_changed" })
  })

  it("deletes expired authentication artifacts using database time", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
    await prisma.$executeRaw`
      INSERT INTO "authorization_attempts" (
        "id", "provider_revision_id", "state_digest", "browser_binding_digest",
        "code_challenge", "code_verifier_ciphertext", "request_ip_digest",
        "expires_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${provider.revisionId}::uuid, ${"a".repeat(64)},
        ${"b".repeat(64)}, ${"c".repeat(43)}, 'encrypted', ${"d".repeat(64)},
        clock_timestamp() - interval '1 millisecond',
        clock_timestamp() - interval '1 second', clock_timestamp()
      )
    `
    await prisma.$executeRaw`
      INSERT INTO "admission_handoffs" (
        "id", "external_identity_id", "provider_revision_id", "token_digest",
        "browser_binding_digest", "revocation_generation", "display_attributes",
        "expires_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${identity.externalIdentityId}::uuid,
        ${provider.revisionId}::uuid, ${"e".repeat(64)}, ${"f".repeat(64)}, 1,
        '{"login":"octocat"}'::jsonb, clock_timestamp() - interval '1 millisecond',
        clock_timestamp() - interval '1 second', clock_timestamp()
      )
    `

    await deleteExpiredAuthorizationAttempts(prisma)
    await deleteExpiredAdmissionHandoffs(prisma)
    await expect(prisma.authorizationAttempt.count()).resolves.toBe(0)
    await expect(prisma.admissionHandoff.count()).resolves.toBe(0)
  })

  it("creates handoffs with the fixed lifetime from database time", async () => {
    const provider = await createProvider()
    const identity = await createIdentity()
    const result = await createAuthenticationAdmissionHandoff(
      {
        browserBindingDigest: hashAuthenticationValue("browser"),
        displayAttributes: {
          login: "octocat",
          name: null,
          avatarUrl: null,
          email: null,
        },
        expectedRevocationGeneration: 1n,
        externalIdentityId: identity.externalIdentityId,
        providerKey: "github",
        providerRevisionId: provider.revisionId,
        tokenDigest: hashAuthenticationValue("handoff"),
      },
      {
        runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
      },
    )
    expect(result.status).toBe("created")
    if (result.status !== "created") throw new Error("Expected a created handoff.")
    expect(result.expiresAt.getTime() - result.createdAt.getTime()).toBe(300_000)
    await expect(prisma.admissionHandoff.findFirstOrThrow()).resolves.toMatchObject({
      createdAt: result.createdAt,
      expiresAt: result.expiresAt,
    })
  })
})
