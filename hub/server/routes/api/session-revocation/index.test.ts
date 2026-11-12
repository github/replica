import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { SessionRevocationDeniedError } from "../../../domains/session-revocation/errors"
import type {
  AuthenticationRouteDependencies,
  SessionRevocationRouteDependencies,
  StartAdministratorAuthorizationDependencies,
} from "../auth/types"

const applicationOrigin = "http://127.0.0.1:5173"
const sessionValue = "current-session"
const session = {
  externalIdentityId: randomUUID(),
  id: randomUUID(),
  membershipId: randomUUID(),
  providerKey: "github",
}

function startDependencies() {
  const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, auditFailed: false })
  const start = vi.fn().mockResolvedValue({
    authorizationId: randomUUID(),
    authorizationUrl: "https://github.com/login/oauth/authorize",
    browserBinding: "browser-binding-with-required-length",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  })
  const dependencies: StartAdministratorAuthorizationDependencies = {
    applicationOrigin,
    checkRateLimit,
    secureCookie: false,
    start,
  }
  return { dependencies, start }
}

function routeDependencies() {
  const github = startDependencies()
  const entra = startDependencies()
  const cancel = vi.fn().mockResolvedValue(true)
  const continueRevocation = vi.fn().mockResolvedValue({
    cancelledAuthorizationCount: 2,
    endedSessionCount: 3,
    revision: 4,
  })
  const findSession = vi.fn().mockResolvedValue(session)
  const getAuthorization = vi.fn().mockResolvedValue({
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    operation: "END_ALL_HUB_SESSIONS",
    targets: [],
    verifiedAt: new Date("2029-12-31T23:59:00Z"),
  })
  const getStatus = vi.fn().mockResolvedValue({
    activeSessionCount: 3,
    pendingAuthenticationCount: 2,
    pendingSensitiveAuthorizationCount: 1,
    revision: 3,
  })
  const sessionRevocation: SessionRevocationRouteDependencies = {
    applicationOrigin,
    cancel,
    continue: continueRevocation,
    findSession,
    getAuthorization,
    getStatus,
    secureCookie: false,
    start: { entra: entra.dependencies, github: github.dependencies },
  }
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore: vi.fn() },
    sessionRevocation,
    signOut: {
      applicationOrigin,
      end: vi.fn(),
      secureCookie: false,
    },
  }
  return {
    authentication,
    continueRevocation,
    findSession,
    getStatus,
    github,
  }
}

async function withServer(
  authentication: AuthenticationRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp({ authentication }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await operation(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}

function sessionHeaders(headers: Record<string, string> = {}) {
  return { cookie: `hub_session=${sessionValue}`, ...headers }
}

describe("sessionRevocationRoutes()", () => {
  it("returns current counts only to a live administrator session", async () => {
    const { authentication, findSession, getStatus } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/session-revocation`, {
        headers: sessionHeaders(),
      })
      expect(allowed.status).toBe(200)
      expect(await allowed.json()).toEqual({
        status: {
          activeSessionCount: 3,
          pendingAuthenticationCount: 2,
          pendingSensitiveAuthorizationCount: 1,
          revision: 3,
        },
      })
      expect(findSession).toHaveBeenCalledWith(
        createHash("sha256").update(sessionValue).digest("hex"),
      )

      findSession.mockResolvedValueOnce(null)
      const denied = await fetch(`${baseUrl}/api/session-revocation`, {
        headers: sessionHeaders(),
      })
      expect(denied.status).toBe(403)
      expect(getStatus).toHaveBeenCalledOnce()
    })
  })

  it("requires explicit confirmation and binds fresh authorization to the actor's current session", async () => {
    const { authentication, github } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const unconfirmed = await fetch(`${baseUrl}/api/session-revocation/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ confirmed: false }),
      })
      expect(unconfirmed.status).toBe(400)
      expect(github.start).not.toHaveBeenCalled()

      const confirmed = await fetch(`${baseUrl}/api/session-revocation/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ confirmed: true }),
      })
      expect(confirmed.status).toBe(200)
      expect(github.start).toHaveBeenCalledWith({
        actorMembershipId: session.membershipId,
        externalIdentityId: session.externalIdentityId,
        hubSessionId: session.id,
        operation: "END_ALL_HUB_SESSIONS",
        targetMembershipIds: [],
      })
    })
  })

  it("clears the actor's Hub session cookie only after a successful continuation", async () => {
    const { authentication, continueRevocation } = routeDependencies()
    const authorizationId = randomUUID()

    await withServer(authentication, async (baseUrl) => {
      const completed = await fetch(`${baseUrl}/api/session-revocation/authorizations/continue`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ authorizationId }),
      })
      expect(completed.status).toBe(200)
      expect(completed.headers.get("set-cookie")).toContain(
        "hub_session=; Path=/; HttpOnly; SameSite=Lax",
      )
      expect(continueRevocation).toHaveBeenCalledWith({
        authorizationId,
        hubSessionId: session.id,
      })

      continueRevocation.mockRejectedValueOnce(new SessionRevocationDeniedError("expired"))
      const denied = await fetch(`${baseUrl}/api/session-revocation/authorizations/continue`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ authorizationId: randomUUID() }),
      })
      expect(denied.status).toBe(409)
      expect(await denied.json()).toEqual({ error: "expired" })
      expect(denied.headers.get("set-cookie")).toBeNull()
    })
  })
})
