import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../create-app"
import { createAuthenticationRouteDependencies } from "../../create-authentication-route-dependencies"
import { prisma } from "../../integrations/prisma"
import { lockSessionRevocationState } from "../../repositories/session-revocation-states/lock-session-revocation-state"
import { restoreHubSession } from "./restore-hub-session"
import { runSessionRestoreTransaction } from "./run-session-restore-transaction"

const applicationOrigin = "http://127.0.0.1:5173"
const clientId = "github-client"

function runtimeEnvironment() {
  return {
    GITHUB_CLIENT_ID: clientId,
    GITHUB_CLIENT_SECRET: "github-secret",
    GITHUB_PROVIDER_REVISION: "1",
    HUB_APPLICATION_ORIGIN: applicationOrigin,
    HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
  }
}

function cookieValue(response: Response, name: string) {
  const header = response.headers.get("set-cookie") ?? ""
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

async function openServer(userIds: number[]) {
  let userIndex = 0
  const providerRequest = vi.fn((input: string | URL | Request) => {
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
  const dependencies = createAuthenticationRouteDependencies(runtimeEnvironment(), providerRequest)
  const server = createServer(createApp({ authentication: dependencies }))
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

describe("Hub admission and session flow", () => {
  it("enforces the migrated global revocation singleton on fresh databases", async () => {
    await expect(
      prisma.sessionRevocationState.create({
        data: { id: randomUUID(), key: "extra", revision: 0 },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.sessionRevocationState.create({
        data: { id: randomUUID(), key: "global", revision: 0 },
      }),
    ).rejects.toThrow()
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
      expect(await restored.json()).toMatchObject({
        authenticated: true,
        role: "administrator",
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
      const signedIn = await completeAuthentication(server.baseUrl, signIn)
      expect(signedIn.headers.get("location")).toBe("/?authentication=success")
      expect(cookieValue(signedIn, "hub_session")).toBeTruthy()
      expect(await prisma.membership.count()).toBe(1)
    } finally {
      await server.close()
    }
  })

  it("keeps bootstrap reusable for another administrator and restores removed authority", async () => {
    const server = await openServer([201, 202, 201])
    const secret = "bootstrap-secret-that-is-at-least-32-characters"
    try {
      for (let index = 0; index < 2; index += 1) {
        const attempt = await startAuthentication(
          server.baseUrl,
          "/api/auth/github/admin-enrollment/start",
          new URLSearchParams({ bootstrap_secret: secret }),
        )
        expect((await completeAuthentication(server.baseUrl, attempt)).status).toBe(303)
      }
      expect(await prisma.membership.count()).toBe(2)

      const firstIdentity = await prisma.externalIdentity.findFirstOrThrow({
        where: { subject: "201" },
        include: { user: { include: { membership: true } } },
      })

      await prisma.membership.update({
        where: { id: firstIdentity.user.membership!.id },
        data: { lifecycle: "REMOVED" },
      })
      const assignmentRestoreAuditsBefore = await prisma.securityAudit.count({
        where: { action: "membership.assignment.restored" },
      })

      const restoration = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({ bootstrap_secret: secret }),
      )
      expect((await completeAuthentication(server.baseUrl, restoration)).status).toBe(303)
      expect(
        await prisma.membership.findUnique({
          where: { id: firstIdentity.user.membership!.id },
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
            targetId: firstIdentity.user.membership!.id,
          },
        }),
      ).toBe(1)
      expect(
        await prisma.securityAudit.count({
          where: { action: "membership.assignment.restored" },
        }),
      ).toBe(assignmentRestoreAuditsBefore)
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

      const unknown = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const denied = await completeAuthentication(server.baseUrl, unknown)
      expect(denied.headers.get("location")).toBe("/?authentication=denied")
      expect(cookieValue(denied, "hub_session")).toBe("")

      const enrollment = await startAuthentication(
        server.baseUrl,
        "/api/auth/github/admin-enrollment/start",
        new URLSearchParams({
          bootstrap_secret: "bootstrap-secret-that-is-at-least-32-characters",
        }),
      )
      const enrolled = await completeAuthentication(server.baseUrl, enrollment)
      const session = cookieValue(enrolled, "hub_session")!
      await prisma.membership.updateMany({ data: { lifecycle: "SUSPENDED" } })
      const suspended = await fetch(`${server.baseUrl}/api/auth/session`, {
        headers: { cookie: `hub_session=${encodeURIComponent(session)}` },
      })
      expect(suspended.status).toBe(401)
      expect(suspended.headers.get("set-cookie")).toContain("Max-Age=0")

      await prisma.membership.updateMany({ data: { lifecycle: "ACTIVE" } })
      const secondSignIn = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const secondSignedIn = await completeAuthentication(server.baseUrl, secondSignIn)
      const secondSession = cookieValue(secondSignedIn, "hub_session")!
      await prisma.membershipAssignment.updateMany({ data: { lifecycle: "REVOKED" } })
      expect(
        await fetch(`${server.baseUrl}/api/auth/session`, {
          headers: { cookie: `hub_session=${encodeURIComponent(secondSession)}` },
        }),
      ).toMatchObject({ status: 401 })

      await prisma.membershipAssignment.updateMany({ data: { lifecycle: "ACTIVE" } })
      const thirdSignIn = await startAuthentication(server.baseUrl, "/api/auth/github/start")
      const thirdSignedIn = await completeAuthentication(server.baseUrl, thirdSignIn)
      const thirdSession = cookieValue(thirdSignedIn, "hub_session")!
      await prisma.membership.updateMany({ data: { lifecycle: "REMOVED" } })
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

  it("enforces immutable bootstrap assignment authority and same-user ownership", async () => {
    const user = await prisma.user.create({ data: { id: randomUUID() } })
    const otherUser = await prisma.user.create({ data: { id: randomUUID() } })
    const identity = await prisma.externalIdentity.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        provider: "github",
        issuer: "https://github.com",
        subject: "999",
      },
    })
    const otherIdentity = await prisma.externalIdentity.create({
      data: {
        id: randomUUID(),
        userId: otherUser.id,
        provider: "github",
        issuer: "https://github.com",
        subject: "1000",
      },
    })
    const membership = await prisma.membership.create({
      data: { id: randomUUID(), userId: user.id },
    })
    const assignment = await prisma.membershipAssignment.create({
      data: {
        id: randomUUID(),
        membershipId: membership.id,
        externalIdentityId: identity.id,
        source: "BOOTSTRAP",
        role: "ADMINISTRATOR",
      },
    })
    const otherMembership = await prisma.membership.create({
      data: { id: randomUUID(), userId: otherUser.id },
    })

    await expect(
      prisma.membershipAssignment.create({
        data: {
          id: randomUUID(),
          membershipId: membership.id,
          externalIdentityId: otherIdentity.id,
          source: "BOOTSTRAP",
          role: "ADMINISTRATOR",
        },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.membershipAssignment.update({
        where: { id: assignment.id },
        data: { membershipId: otherMembership.id },
      }),
    ).rejects.toThrow("identity and authority are immutable")
    await expect(
      prisma.membershipAssignment.update({
        where: { id: assignment.id },
        data: { externalIdentityId: otherIdentity.id },
      }),
    ).rejects.toThrow("identity and authority are immutable")
    await expect(
      prisma.$executeRaw`
        UPDATE "membership_assignments"
        SET "source" = 'PROVIDER'
        WHERE "id" = ${assignment.id}::uuid
      `,
    ).rejects.toThrow()
    await expect(
      prisma.$executeRaw`
        UPDATE "membership_assignments"
        SET "role" = 'MEMBER'
        WHERE "id" = ${assignment.id}::uuid
      `,
    ).rejects.toThrow()
    await expect(
      prisma.membershipAssignment.delete({ where: { id: assignment.id } }),
    ).rejects.toThrow("cannot be deleted")

    await prisma.membershipAssignment.update({
      where: { id: assignment.id },
      data: { lifecycle: "REVOKED" },
    })
    await prisma.membershipAssignment.update({
      where: { id: assignment.id },
      data: { lifecycle: "ACTIVE" },
    })
    await expect(
      prisma.membershipAssignment.findUnique({ where: { id: assignment.id } }),
    ).resolves.toMatchObject({
      externalIdentityId: identity.id,
      membershipId: membership.id,
      lifecycle: "ACTIVE",
      role: "ADMINISTRATOR",
      source: "BOOTSTRAP",
    })

    const expiredDigest = "f".repeat(64)
    await prisma.hubSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        membershipId: membership.id,
        digest: expiredDigest,
        revocationRevision: 0,
        createdAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2020-01-01T00:00:00Z"),
        expiresAt: new Date("2020-01-02T00:00:00Z"),
      },
    })
    await expect(
      restoreHubSession(expiredDigest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      }),
    ).resolves.toBeNull()

    const liveDigest = "e".repeat(64)
    await prisma.hubSession.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        membershipId: membership.id,
        digest: liveDigest,
        revocationRevision: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "session_revocation_states" DISABLE TRIGGER "session_revocation_states_protected"`,
    )
    await prisma.sessionRevocationState.delete({ where: { key: "global" } })
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "session_revocation_states" ENABLE TRIGGER "session_revocation_states_protected"`,
    )
    await expect(
      prisma.$transaction((transaction) => lockSessionRevocationState(transaction)),
    ).resolves.toBeNull()
    await expect(
      restoreHubSession(liveDigest, {
        runTransaction: (operation) => runSessionRestoreTransaction(prisma, operation),
      }),
    ).resolves.toBeNull()
    expect(await prisma.sessionRevocationState.count()).toBe(0)
  })
})
