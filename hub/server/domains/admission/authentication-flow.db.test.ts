import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pg from "pg"
import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "../../../test/database/get-database-url"
import { createApp } from "../../create-app"
import { createLogger } from "../../integrations/pino/create-logger"
import { prisma } from "../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../routes/api/auth/create-authentication-route-dependencies"
import { disableAuthenticationProviders } from "../../routes/api/auth/create-authentication-route-dependencies"
import { restoreHubSession } from "./restore-hub-session"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

const applicationOrigin = "http://127.0.0.1:5173"
const clientId = "github-client"

function runtimeEnvironment(bootstrapSecret = "bootstrap-secret-that-is-at-least-32-characters") {
  return {
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: "github-secret",
    GITHUB_PROVIDER_REVISION: "1",
    HUB_APPLICATION_ORIGIN: applicationOrigin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: bootstrapSecret,
  }
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? ""
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function openServer(
  userIds: number[],
  logger?: ReturnType<typeof createLogger>,
  environment = runtimeEnvironment(),
  providerRequestOverride?: ReturnType<typeof vi.fn<typeof fetch>>,
) {
  let userIndex = 0
  const providerRequest =
    providerRequestOverride ??
    vi.fn((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve(
          Response.json({ access_token: "provider-token", token_type: "bearer" }),
        )
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve(Response.json({ id: userIds[userIndex++]! }))
      }
      throw new Error(`Unexpected provider request: ${url}`)
    })
  const dependencies = await createAuthenticationRouteDependencies(environment, providerRequest)
  const server = createServer(
    createApp({ authentication: dependencies, ...(logger ? { logger } : {}) }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    providerRequest,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function startAuthentication(baseUrl: string, path: string, body?: URLSearchParams) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      origin: applicationOrigin,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    redirect: "manual",
  })
  const location = response.headers.get("location")
  if (!location) throw new Error("Authentication start did not redirect.")
  const state = new URL(location).searchParams.get("state")
  const browserCookie = cookieValue(response, "hub_auth_browser")
  if (!state || !browserCookie) throw new Error("Authentication start was incomplete.")
  return { browserCookie, state }
}

async function completeAuthentication(
  baseUrl: string,
  attempt: { browserCookie: string; state: string },
) {
  return fetch(`${baseUrl}/api/auth/github/callback?code=provider-code&state=${attempt.state}`, {
    headers: { cookie: `hub_auth_browser=${encodeURIComponent(attempt.browserCookie)}` },
    redirect: "manual",
  })
}

async function waitForMembershipLock(inspector: pg.Client) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ pid: number }>(`
      SELECT pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query LIKE '%FROM "memberships"%'
      ORDER BY query_start DESC
      LIMIT 1
    `)
    if (result.rows[0]) return result.rows[0].pid
    await Promise.resolve()
  }
  return null
}

async function waitForAuthenticationCompletionLock(inspector: pg.Client, lockerPid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ pid: number }>(
      `SELECT pid
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> $1
         AND state = 'active'
         AND wait_event_type = 'Lock'
       ORDER BY query_start DESC
       LIMIT 1`,
      [lockerPid],
    )
    if (result.rows[0]) return result.rows[0].pid
    await Promise.resolve()
  }
  return null
}

describe("Hub admission and session flow", () => {
  it("audits malformed verification state before provider or admission work", async () => {
    const records: string[] = []
    const logger = createLogger({ destination: { write: (line) => records.push(line) } })
    const server = await openServer([], logger)
    const state = `malformed-verification-state-${"s".repeat(32)}`
    const browserBinding = `malformed-browser-binding-${"b".repeat(32)}`
    const malformedCiphertext = "malformed-code-verifier-ciphertext"
    try {
      await startAuthentication(server.baseUrl, "/api/auth/github/start")
      records.length = 0
      const providerRevision = await prisma.authenticationProviderRevision.findFirstOrThrow({
        select: { id: true },
      })
      const attemptId = randomUUID()
      await prisma.$executeRaw`
        INSERT INTO "authorization_attempts" (
          "id", "provider_revision_id", "state_digest", "browser_binding_digest",
          "purpose", "code_verifier_ciphertext", "nonce_ciphertext",
          "session_revocation_revision", "expires_at", "created_at", "updated_at"
        ) VALUES (
          ${attemptId}::uuid,
          ${providerRevision.id}::uuid,
          ${createHash("sha256").update(state).digest("hex")},
          ${createHash("sha256").update(browserBinding).digest("hex")},
          'SIGN_IN',
          ${malformedCiphertext},
          'encrypted-nonce',
          0,
          CURRENT_TIMESTAMP + interval '5 minutes',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `
      const auditCount = await prisma.securityAudit.count()

      const response = await fetch(
        `${server.baseUrl}/api/auth/github/callback?code=unused-provider-code&state=${state}`,
        {
          headers: { cookie: `hub_auth_browser=${encodeURIComponent(browserBinding)}` },
          redirect: "manual",
        },
      )

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.text()).not.toMatch(
        /malformed-verification-state|malformed-browser-binding|malformed-code-verifier|unused-provider-code|verification_state_invalid/,
      )
      expect(server.providerRequest).not.toHaveBeenCalled()
      const consumedAttempt = await prisma.authorizationAttempt.findUnique({
        where: { id: attemptId },
        select: { consumedAt: true },
      })
      expect(consumedAttempt?.consumedAt).toBeInstanceOf(Date)
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.externalIdentity.count()).toBe(0)
      expect(await prisma.membership.count()).toBe(0)
      expect(await prisma.membershipAssignment.count()).toBe(0)
      expect(await prisma.hubSession.count()).toBe(0)
      await expect(
        prisma.securityAudit.findMany({
          orderBy: { createdAt: "asc" },
          skip: auditCount,
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          action: "authentication.attempt.denied",
          outcome: "DENIED",
          context: {
            provider: "github",
            reason: "verification_state_invalid",
          },
        }),
      ])
      await vi.waitFor(() => expect(records).toHaveLength(1))
      expect(records[0]).not.toMatch(
        /malformed-verification-state|malformed-browser-binding|malformed-code-verifier|unused-provider-code|verification_state_invalid/,
      )
    } finally {
      await server.close()
    }
  })

  it("enrolls an administrator, restores the session, signs out, and signs in again", async () => {
    const server = await openServer([101, 101, 101])
    try {
      const enrollment = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const provider = await prisma.authenticationProvider.findUnique({
        where: { key: "github" },
        select: {
          selectedRevision: {
            select: { revision: true, configurationDigest: true },
          },
        },
      })
      expect(provider?.selectedRevision?.revision).toBe(1)
      expect(provider?.selectedRevision?.configurationDigest).toMatch(/^[0-9a-f]{64}$/)
      const enrolled = await completeAuthentication(server.baseUrl, enrollment)
      expect(enrolled.status).toBe(303)
      expect(enrolled.headers.get("location")).toBe("/?authentication=success")
      const firstSession = cookieValue(enrolled, "hub_session")
      expect(firstSession).toBeTruthy()
      expect(await prisma.membership.count()).toBe(1)
      expect(
        await prisma.membershipAssignment.findFirst({
          select: { source: true, role: true, lifecycle: true },
        }),
      ).toEqual({
        source: "BOOTSTRAP",
        role: "ADMINISTRATOR",
        lifecycle: "ACTIVE",
      })
      expect(await prisma.hubSession.findFirst({ select: { digest: true } })).toEqual({
        digest: createHash("sha256").update(firstSession!).digest("hex"),
      })
      const persistedAuthenticationData = JSON.stringify({
        attempts: await prisma.authorizationAttempt.findMany(),
        audits: await prisma.securityAudit.findMany(),
        sessions: await prisma.hubSession.findMany(),
      })
      expect(persistedAuthenticationData).not.toMatch(
        /bootstrap-secret-that|provider-code|provider-token/,
      )
      expect(persistedAuthenticationData).not.toContain(enrollment.browserCookie)
      expect(persistedAuthenticationData).not.toContain(enrollment.state)
      expect(persistedAuthenticationData).not.toContain(firstSession!)

      const duplicateAttempt = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const duplicateCallbacks = await Promise.all([
        completeAuthentication(server.baseUrl, duplicateAttempt),
        completeAuthentication(server.baseUrl, duplicateAttempt),
      ])
      expect(duplicateCallbacks.map((response) => response.headers.get("location")).sort()).toEqual(
        ["/?authentication=denied", "/?authentication=success"],
      )
      expect(await prisma.hubSession.count()).toBe(2)

      const restored = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: { cookie: `hub_session=${encodeURIComponent(firstSession!)}` },
      })
      expect(restored.status).toBe(200)
      expect(await restored.json()).toEqual({
        authenticated: true,
        role: "ADMINISTRATOR",
      })
      const auditCountBeforeRestores = await prisma.securityAudit.count()
      const repeatedRestores = await Promise.all(
        Array.from({ length: 20 }, () =>
          fetch(`${server.baseUrl}/api/auth/session`, {
            headers: { cookie: `hub_session=${encodeURIComponent(firstSession!)}` },
          }),
        ),
      )
      expect(repeatedRestores.every((response) => response.status === 200)).toBe(true)
      expect(await prisma.securityAudit.count()).toBe(auditCountBeforeRestores)

      const signedOut = await fetch(`${server.baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          cookie: `hub_session=${encodeURIComponent(firstSession!)}`,
          origin: applicationOrigin,
        },
      })
      expect(signedOut.status).toBe(204)
      const endedSession = await prisma.hubSession.findUnique({
        where: { digest: createHash("sha256").update(firstSession!).digest("hex") },
        select: { endedAt: true },
      })
      expect(endedSession?.endedAt).toBeInstanceOf(Date)
      const auditCountAfterSignOut = await prisma.securityAudit.count()
      const replayedSignOut = await fetch(`${server.baseUrl}/api/auth/session/sign-out`, {
        method: "POST",
        headers: {
          cookie: `hub_session=${encodeURIComponent(firstSession!)}`,
          origin: applicationOrigin,
        },
      })
      expect(replayedSignOut.status).toBe(204)
      expect(await prisma.securityAudit.count()).toBe(auditCountAfterSignOut)

      const signIn = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      expect(
        await prisma.authorizationAttempt.findUniqueOrThrow({
          where: {
            stateDigest: createHash("sha256").update(signIn.state).digest("hex"),
          },
          select: { bootstrapSecretDigest: true, purpose: true },
        }),
      ).toEqual({ bootstrapSecretDigest: null, purpose: "SIGN_IN" })
      const signedIn = await completeAuthentication(server.baseUrl, signIn)
      expect(signedIn.headers.get("location")).toBe("/?authentication=success")
      expect(cookieValue(signedIn, "hub_session")).toBeTruthy()
      expect(await prisma.membership.count()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it("consumes and denies enrollment when the bootstrap secret rotates before callback", async () => {
    const originalSecret = "original-bootstrap-secret-that-is-at-least-32-characters"
    const rotatedSecret = "rotated-bootstrap-secret-that-is-at-least-32-characters"
    const originalDigest = createHash("sha256").update(originalSecret).digest("hex")
    const environment = runtimeEnvironment(originalSecret)
    const originalServer = await openServer([], undefined, environment)
    let enrollment: Awaited<ReturnType<typeof startAuthentication>>
    try {
      enrollment = await startAuthentication(
        originalServer.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({ bootstrap_secret: originalSecret }),
      )
      const attempt = await prisma.authorizationAttempt.findFirstOrThrow({
        select: { bootstrapSecretDigest: true, purpose: true },
      })

      expect(attempt).toEqual({
        bootstrapSecretDigest: originalDigest,
        purpose: "ADMIN_ENROLLMENT",
      })
      expect(attempt.bootstrapSecretDigest).toMatch(/^[0-9a-f]{64}$/)
    } finally {
      await originalServer.close()
    }

    const logRecords: string[] = []
    const logger = createLogger({ destination: { write: (line) => logRecords.push(line) } })
    const rotatedServer = await openServer([601], logger, {
      ...environment,
      HUB_BOOTSTRAP_SECRET: rotatedSecret,
    })
    try {
      const response = await completeAuthentication(rotatedServer.baseUrl, enrollment)

      expect(response.status).toBe(303)
      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(response, "hub_session")).toBeNull()
      const consumedAttempt = await prisma.authorizationAttempt.findFirstOrThrow({
        select: { consumedAt: true },
      })
      expect(consumedAttempt.consumedAt).toBeInstanceOf(Date)
      expect(await prisma.membership.count()).toBe(0)
      expect(await prisma.membershipAssignment.count()).toBe(0)
      expect(await prisma.hubSession.count()).toBe(0)
      await expect(
        prisma.securityAudit.findMany({
          where: { action: "admission.denied" },
          select: { action: true, context: true, outcome: true },
        }),
      ).resolves.toEqual([
        {
          action: "admission.denied",
          context: { reason: "configuration_changed" },
          outcome: "DENIED",
        },
      ])

      const persistedData = JSON.stringify({
        attempts: await prisma.authorizationAttempt.findMany(),
        audits: await prisma.securityAudit.findMany(),
      })
      expect(persistedData).not.toContain(originalSecret)
      expect(persistedData).not.toContain(rotatedSecret)
      expect(JSON.stringify(await prisma.securityAudit.findMany())).not.toContain(originalDigest)
      await vi.waitFor(() => expect(logRecords).toHaveLength(1))
      expect(logRecords[0]).not.toContain(originalSecret)
      expect(logRecords[0]).not.toContain(rotatedSecret)
      expect(logRecords[0]).not.toContain(originalDigest)
    } finally {
      await rotatedServer.close()
    }
  })

  it("denies old-version admission after disable and identical revision-two reactivation", async () => {
    const environment = runtimeEnvironment()
    const original = await openServer([], undefined, environment)
    try {
      await startAuthentication(
        original.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
    } finally {
      await original.close()
    }
    const selectedRevisionId = (
      await prisma.authenticationProvider.findUniqueOrThrow({
        where: { key: "github" },
        select: { selectedRevisionId: true },
      })
    ).selectedRevisionId

    await disableAuthenticationProviders()
    const oldVersionAttempt = {
      browserCookie: `old-version-browser-${"b".repeat(32)}`,
      state: `old-version-state-${"s".repeat(32)}`,
    }
    await prisma.authorizationAttempt.create({
      data: {
        bootstrapSecretDigest: createHash("sha256")
          .update("bootstrap-secret-that-is-at-least-32-characters")
          .digest("hex"),
        browserBindingDigest: createHash("sha256")
          .update(oldVersionAttempt.browserCookie)
          .digest("hex"),
        codeVerifierCiphertext: "old-version-encrypted-verifier",
        expiresAt: new Date(Date.now() + 60_000),
        id: randomUUID(),
        nonceCiphertext: "old-version-encrypted-nonce",
        providerRevisionId: selectedRevisionId!,
        purpose: "ADMIN_ENROLLMENT",
        sessionRevocationRevision: 1,
        stateDigest: createHash("sha256").update(oldVersionAttempt.state).digest("hex"),
      },
    })
    const reenabled = await openServer([701], undefined, {
      ...environment,
      GITHUB_PROVIDER_REVISION: "2",
    })
    try {
      const provider = await prisma.authenticationProvider.findUniqueOrThrow({
        where: { key: "github" },
        select: {
          enabled: true,
          selectedRevision: { select: { id: true, revision: true } },
        },
      })
      expect(provider.enabled).toBe(true)
      expect(provider.selectedRevision?.revision).toBe(2)
      expect(typeof provider.selectedRevision?.id).toBe("string")
      expect(provider.selectedRevision!.id).not.toBe(selectedRevisionId)

      const stale = await completeAuthentication(reenabled.baseUrl, oldVersionAttempt)

      expect(stale.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(stale, "hub_session")).toBeNull()
      expect(reenabled.providerRequest).not.toHaveBeenCalled()
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.externalIdentity.count()).toBe(0)
      expect(await prisma.membership.count()).toBe(0)
      expect(await prisma.membershipAssignment.count()).toBe(0)
      expect(await prisma.hubSession.count()).toBe(0)

      const replay = await completeAuthentication(reenabled.baseUrl, oldVersionAttempt)
      expect(replay.headers.get("location")).toBe("/?authentication=denied")
      expect(reenabled.providerRequest).not.toHaveBeenCalled()

      const freshAttempt = await startAuthentication(
        reenabled.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const fresh = await completeAuthentication(reenabled.baseUrl, freshAttempt)

      expect(fresh.headers.get("location")).toBe("/?authentication=success")
      expect(cookieValue(fresh, "hub_session")).toBeTruthy()
      expect(reenabled.providerRequest).toHaveBeenCalledTimes(2)
      expect(await prisma.membershipAssignment.count()).toBe(1)
      expect(await prisma.hubSession.count()).toBe(1)
    } finally {
      await reenabled.close()
    }
  })

  it("fails closed when global revocation advances during provider network work", async () => {
    const providerStarted = deferred<void>()
    const tokenResponse = deferred<Response>()
    const providerRequest = vi.fn<typeof fetch>((input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === "https://github.com/login/oauth/access_token") {
        providerStarted.resolve()
        return tokenResponse.promise
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve(Response.json({ id: 702 }))
      }
      throw new Error(`Unexpected provider request: ${url}`)
    })
    const server = await openServer([702], undefined, runtimeEnvironment(), providerRequest)
    try {
      const attempt = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const completion = completeAuthentication(server.baseUrl, attempt)
      await providerStarted.promise
      await prisma.sessionRevocationState.update({
        where: { key: "global" },
        data: { revision: { increment: 1 } },
      })
      tokenResponse.resolve(Response.json({ access_token: "provider-token", token_type: "bearer" }))

      const response = await completion

      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(response, "hub_session")).toBeNull()
      expect(providerRequest).toHaveBeenCalledTimes(2)
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.externalIdentity.count()).toBe(0)
      expect(await prisma.membership.count()).toBe(0)
      expect(await prisma.membershipAssignment.count()).toBe(0)
      expect(await prisma.hubSession.count()).toBe(0)
    } finally {
      tokenResponse.resolve(Response.json({ access_token: "unused", token_type: "bearer" }))
      await server.close()
    }
  })

  it("creates no identity when revocation advances immediately before identity mutation", async () => {
    const providerStarted = deferred<void>()
    const tokenResponse = deferred<Response>()
    const providerRequest = vi.fn<typeof fetch>((input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === "https://github.com/login/oauth/access_token") {
        providerStarted.resolve()
        return tokenResponse.promise
      }
      if (url === "https://api.github.com/user") {
        return Promise.resolve(Response.json({ id: 703 }))
      }
      throw new Error(`Unexpected provider request: ${url}`)
    })
    const server = await openServer([703], undefined, runtimeEnvironment(), providerRequest)
    const locker = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([locker.connect(), inspector.connect()])
    const lockerPid = (await locker.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`))
      .rows[0]!.pid
    try {
      const attempt = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      await locker.query("BEGIN")
      await locker.query(`SELECT id FROM authentication_providers WHERE key = 'github' FOR UPDATE`)
      await locker.query(`LOCK TABLE users IN ACCESS EXCLUSIVE MODE`)

      const completion = completeAuthentication(server.baseUrl, attempt)
      await providerStarted.promise
      tokenResponse.resolve(Response.json({ access_token: "provider-token", token_type: "bearer" }))
      expect(await waitForAuthenticationCompletionLock(inspector, lockerPid)).not.toBeNull()
      await locker.query(
        `UPDATE session_revocation_states
         SET revision = revision + 1, updated_at = clock_timestamp()
         WHERE key = 'global'`,
      )
      await locker.query("COMMIT")

      const response = await completion

      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(response, "hub_session")).toBeNull()
      expect(await prisma.user.count()).toBe(0)
      expect(await prisma.externalIdentity.count()).toBe(0)
      expect(await prisma.membership.count()).toBe(0)
      expect(await prisma.membershipAssignment.count()).toBe(0)
      expect(await prisma.hubSession.count()).toBe(0)
      expect(
        await prisma.securityAudit.count({
          where: {
            action: {
              in: [
                "identity.external.created",
                "membership.created",
                "membership.assignment.created",
                "session.created",
              ],
            },
          },
        }),
      ).toBe(0)
    } finally {
      tokenResponse.resolve(Response.json({ access_token: "unused", token_type: "bearer" }))
      await Promise.allSettled([locker.query("ROLLBACK")])
      await Promise.all([locker.end(), inspector.end(), server.close()])
    }
  })

  it("keeps bootstrap reusable for another administrator and restores removed authority", async () => {
    const server = await openServer([201, 202, 201, 201, 201])
    const secret = "bootstrap-secret-that-is-at-least-32-characters"
    try {
      const enrollmentSessions: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const attempt = await startAuthentication(
          server.baseUrl,
          "/api/auth/github/admin-enrollment/start",
          new URLSearchParams({ bootstrap_secret: secret }),
        )
        const response = await completeAuthentication(server.baseUrl, attempt)
        expect(response.status).toBe(303)
        enrollmentSessions.push(cookieValue(response, "hub_session")!)
      }
      expect(await prisma.membership.count()).toBe(2)

      const firstIdentity = await prisma.externalIdentity.findFirstOrThrow({
        where: { subject: "201" },
        include: { user: { include: { membership: true } } },
      })
      const firstMembershipId = firstIdentity.user.membership!.id
      const additionalSessions: string[] = []
      for (let index = 0; index < 2; index += 1) {
        const attempt = await startAuthentication(server.baseUrl, "/api/auth/github/start")
        const response = await completeAuthentication(server.baseUrl, attempt)
        expect(response.headers.get("location")).toBe("/?authentication=success")
        additionalSessions.push(cookieValue(response, "hub_session")!)
      }
      const oldSessionDigests = [enrollmentSessions[0]!, ...additionalSessions].map((session) =>
        createHash("sha256").update(session).digest("hex"),
      )
      const oldSessions = await prisma.hubSession.findMany({
        where: { digest: { in: oldSessionDigests } },
        orderBy: { id: "asc" },
        select: { id: true, digest: true },
      })
      expect(oldSessions).toHaveLength(3)

      const alreadyEndedSession = oldSessions[0]!
      const alreadyEndedAt = new Date(Date.now() + 1_000)
      await prisma.hubSession.update({
        where: { id: alreadyEndedSession.id },
        data: { endedAt: alreadyEndedAt },
      })

      await prisma.$executeRaw`
        UPDATE "memberships"
        SET "lifecycle" = 'REMOVED', "updated_at" = clock_timestamp()
        WHERE "id" = ${firstMembershipId}::uuid
      `
      await prisma.$executeRaw`
        UPDATE "membership_assignments"
        SET "lifecycle" = 'REVOKED', "updated_at" = clock_timestamp()
        WHERE "membership_id" = ${firstMembershipId}::uuid
      `
      const assignmentRestoreAuditsBefore = await prisma.securityAudit.count({
        where: { action: "membership.assignment.restored" },
      })
      const sessionEndedAuditsBefore = await prisma.securityAudit.count({
        where: { action: "session.ended" },
      })
      const newlyEndedSessionIds = oldSessions
        .filter(({ id }) => id !== alreadyEndedSession.id)
        .map(({ id }) => id)
        .sort()

      const restoration = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({ bootstrap_secret: secret }),
      )
      const restored = await completeAuthentication(server.baseUrl, restoration)
      expect(restored.status).toBe(303)
      const replacementSession = cookieValue(restored, "hub_session")!
      expect(
        await prisma.membership.findUnique({
          where: { id: firstMembershipId },
          select: { lifecycle: true, assignments: { select: { lifecycle: true } } },
        }),
      ).toEqual({
        lifecycle: "ACTIVE",
        assignments: [{ lifecycle: "ACTIVE" }],
      })
      expect(
        await prisma.securityAudit.count({
          where: {
            action: "membership.restored",
            targetId: firstMembershipId,
          },
        }),
      ).toBe(1)
      expect(
        await prisma.securityAudit.count({
          where: { action: "membership.assignment.restored" },
        }),
      ).toBe(assignmentRestoreAuditsBefore + 1)

      const persistedOldSessions = await prisma.hubSession.findMany({
        where: { id: { in: oldSessions.map(({ id }) => id) } },
        orderBy: { id: "asc" },
        select: { id: true, endedAt: true },
      })
      expect(persistedOldSessions.map(({ id }) => id)).toEqual(oldSessions.map(({ id }) => id))
      expect(persistedOldSessions.every(({ endedAt }) => endedAt instanceof Date)).toBe(true)
      expect(persistedOldSessions.find(({ id }) => id === alreadyEndedSession.id)?.endedAt).toEqual(
        alreadyEndedAt,
      )

      const newSessionEndedAudits = await prisma.securityAudit.findMany({
        where: {
          action: "session.ended",
          targetId: { in: newlyEndedSessionIds },
        },
        orderBy: { targetId: "asc" },
        select: { context: true, targetId: true },
      })
      expect(await prisma.securityAudit.count({ where: { action: "session.ended" } })).toBe(
        sessionEndedAuditsBefore + 2,
      )
      expect(newSessionEndedAudits).toEqual(
        newlyEndedSessionIds.map((sessionId) => ({
          context: { membershipId: firstMembershipId },
          targetId: sessionId,
        })),
      )

      const replacementDigest = createHash("sha256").update(replacementSession).digest("hex")
      expect(
        await prisma.hubSession.findUniqueOrThrow({
          where: { digest: replacementDigest },
          select: { endedAt: true, membershipId: true },
        }),
      ).toEqual({ endedAt: null, membershipId: firstMembershipId })
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(additionalSessions[0]!)}` },
        }),
      ).toMatchObject({ status: 401 })
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(replacementSession)}` },
        }),
      ).toMatchObject({ status: 200 })

      const otherMembershipSessionDigest = createHash("sha256")
        .update(enrollmentSessions[1]!)
        .digest("hex")
      expect(
        await prisma.hubSession.findUniqueOrThrow({
          where: { digest: otherMembershipSessionDigest },
          select: { endedAt: true },
        }),
      ).toEqual({ endedAt: null })
    } finally {
      await server.close()
    }
  })

  it("converges concurrent bootstrap callbacks for the same and different identities", async () => {
    const secret = "bootstrap-secret-that-is-at-least-32-characters"
    const server = await openServer([401, 401, 402, 403])
    try {
      const sameIdentityAttempts = await Promise.all(
        Array.from({ length: 2 }, () =>
          startAuthentication(
            server.baseUrl,
            "/api/auth/github/admin-enrollment/start",
            new URLSearchParams({ bootstrap_secret: secret }),
          ),
        ),
      )
      const sameIdentityCallbacks = await Promise.all(
        sameIdentityAttempts.map((attempt) => completeAuthentication(server.baseUrl, attempt)),
      )
      expect(sameIdentityCallbacks.map((response) => response.headers.get("location"))).toEqual([
        "/?authentication=success",
        "/?authentication=success",
      ])
      expect(await prisma.membership.count()).toBe(1)
      expect(await prisma.membershipAssignment.count()).toBe(1)
      expect(await prisma.hubSession.count()).toBe(2)

      const differentIdentityAttempts = await Promise.all(
        Array.from({ length: 2 }, () =>
          startAuthentication(
            server.baseUrl,
            "/api/auth/github/admin-enrollment/start",
            new URLSearchParams({ bootstrap_secret: secret }),
          ),
        ),
      )
      const differentIdentityCallbacks = await Promise.all(
        differentIdentityAttempts.map((attempt) => completeAuthentication(server.baseUrl, attempt)),
      )
      expect(
        differentIdentityCallbacks.map((response) => response.headers.get("location")),
        JSON.stringify(await prisma.securityAudit.findMany()),
      ).toEqual(["/?authentication=success", "/?authentication=success"])
      expect(await prisma.membership.count()).toBe(3)
      expect(await prisma.membershipAssignment.count()).toBe(3)
      expect(await prisma.hubSession.count()).toBe(4)
    } finally {
      await server.close()
    }
  })

  it("does not admit an active member assignment", async () => {
    const providerId = randomUUID()
    const providerRevisionId = randomUUID()
    const userId = randomUUID()
    const identityId = randomUUID()
    const membershipId = randomUUID()
    await prisma.$transaction(async (transaction) => {
      await transaction.authenticationProvider.create({
        data: { enabled: false, id: providerId, key: "disabled-fixture-provider" },
      })
      await transaction.authenticationProviderRevision.create({
        data: {
          configurationDigest: "f".repeat(64),
          id: providerRevisionId,
          providerId,
          revision: 1,
        },
      })
    })
    await prisma.user.create({ data: { id: userId } })
    await prisma.externalIdentity.create({
      data: {
        id: identityId,
        userId,
        provider: "github",
        issuer: "https://github.com",
        subject: "301",
      },
    })
    await prisma.membership.create({
      data: { id: membershipId, userId },
    })
    await prisma.membershipAssignment.create({
      data: {
        id: randomUUID(),
        membershipId,
        externalIdentityId: identityId,
        providerAssignmentSubject: randomUUID(),
        providerRevisionId,
        source: "AUTHENTICATION_PROVIDER",
        role: "MEMBER",
      },
    })
    const server = await openServer([301])
    try {
      const attempt = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const response = await completeAuthentication(server.baseUrl, attempt)

      expect(response.headers.get("location")).toBe("/?authentication=denied")
      expect(await prisma.hubSession.count()).toBe(0)
    } finally {
      await server.close()
    }
  })

  it("denies invalid bootstrap, unknown sign-in, retained cookies after suspension, and proof IDs", async () => {
    const server = await openServer([301, 302, 302, 302, 302])
    try {
      const invalid = await fetch(`${server.baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ bootstrap_secret: "wrong" }),
        redirect: "manual",
      })
      expect(invalid.status).toBe(403)
      expect(server.providerRequest).not.toHaveBeenCalled()
      expect(await prisma.authorizationAttempt.count()).toBe(0)

      const unknown = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const denied = await completeAuthentication(server.baseUrl, unknown)
      expect(denied.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(denied, "hub_session")).toBeNull()

      const enrollment = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const enrolled = await completeAuthentication(server.baseUrl, enrollment)
      const session = cookieValue(enrolled, "hub_session")!
      await prisma.$executeRaw`
        UPDATE "memberships"
        SET "lifecycle" = 'SUSPENDED', "updated_at" = clock_timestamp()
      `
      const suspended = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: { cookie: `hub_session=${encodeURIComponent(session)}` },
      })
      expect(suspended.status).toBe(401)
      expect(suspended.headers.get("set-cookie")).toBeNull()

      await prisma.$executeRaw`
        UPDATE "memberships"
        SET "lifecycle" = 'ACTIVE', "updated_at" = clock_timestamp()
      `
      const secondSignIn = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const secondSignedIn = await completeAuthentication(server.baseUrl, secondSignIn)
      const secondSession = cookieValue(secondSignedIn, "hub_session")!
      await prisma.$executeRaw`
        UPDATE "membership_assignments"
        SET "lifecycle" = 'REVOKED', "updated_at" = clock_timestamp()
      `
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(secondSession)}` },
        }),
      ).toMatchObject({ status: 401 })

      await prisma.$executeRaw`
        UPDATE "membership_assignments"
        SET "lifecycle" = 'ACTIVE', "updated_at" = clock_timestamp()
      `
      const thirdSignIn = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const thirdSignedIn = await completeAuthentication(server.baseUrl, thirdSignIn)
      const thirdSession = cookieValue(thirdSignedIn, "hub_session")!
      await prisma.$executeRaw`
        UPDATE "memberships"
        SET "lifecycle" = 'REMOVED', "updated_at" = clock_timestamp()
      `
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(thirdSession)}` },
        }),
      ).toMatchObject({ status: 401 })

      const restoration = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const restored = await completeAuthentication(server.baseUrl, restoration)
      const restoredSession = cookieValue(restored, "hub_session")!
      await prisma.sessionRevocationState.update({
        where: { key: "global" },
        data: { revision: { increment: 1 } },
      })
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(restoredSession)}` },
        }),
      ).toMatchObject({ status: 401 })

      const injected = await fetch(
        `${server.baseUrl}/api/auth/github/callback?authorizationAttemptId=${randomUUID()}&externalIdentityId=${randomUUID()}`,
        { redirect: "manual" },
      )
      expect(injected.headers.get("location")).toBe("/?authentication=denied")
    } finally {
      await server.close()
    }
  })

  it("denies a session that expires while membership authority is locked", async () => {
    const user = await prisma.user.create({ data: { id: randomUUID() } })
    const identity = await prisma.externalIdentity.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        provider: "github",
        issuer: "https://github.com",
        subject: "restore-expiry",
      },
    })
    const membership = await prisma.membership.create({
      data: { id: randomUUID(), userId: user.id },
    })
    await prisma.membershipAssignment.create({
      data: {
        id: randomUUID(),
        membershipId: membership.id,
        externalIdentityId: identity.id,
        source: "BOOTSTRAP",
        role: "ADMINISTRATOR",
      },
    })
    const digest = "d".repeat(64)
    await prisma.hubSession.create({
      data: {
        id: randomUUID(),
        membershipId: membership.id,
        digest,
        revocationRevision: 0,
        expiresAt: new Date(Date.now() + 500),
      },
    })
    const locker = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([locker.connect(), inspector.connect()])
    try {
      await locker.query("BEGIN")
      await locker.query(`SELECT id FROM memberships WHERE id = $1 FOR UPDATE`, [membership.id])
      const restoration = restoreHubSession(digest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      })
      expect(await waitForMembershipLock(inspector)).not.toBeNull()
      await locker.query(`SELECT pg_sleep(0.75)`)
      await locker.query("COMMIT")

      await expect(restoration).resolves.toBeNull()
    } finally {
      await Promise.allSettled([locker.query("ROLLBACK")])
      await Promise.all([locker.end(), inspector.end()])
    }
  })
})
