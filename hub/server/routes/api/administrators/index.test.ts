import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { AdministratorAuthorizationDeniedError } from "../../../domains/administrator-authorization/errors"
import { createApp } from "../../../create-app"
import type {
  AdministratorRouteDependencies,
  AuthenticationRouteDependencies,
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
  const authorizationId = randomUUID()
  const start = vi.fn().mockResolvedValue({
    authorizationId,
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
  return { authorizationId, checkRateLimit, dependencies, start }
}

function routeDependencies() {
  const github = startDependencies()
  const entra = startDependencies()
  const cancel = vi.fn().mockResolvedValue(true)
  const continueAuthorization = vi.fn().mockResolvedValue({ changed: true })
  const findSession = vi.fn().mockResolvedValue(session)
  const getAuthorization = vi.fn().mockResolvedValue({
    operation: "REVOKE_ADMINISTRATOR",
    targetMembershipIds: [randomUUID()],
  })
  const list = vi.fn().mockResolvedValue({ administrators: [], nextCursor: null })
  const listSecurityAudits = vi.fn().mockResolvedValue({ records: [], nextCursor: null })
  const search = vi.fn().mockResolvedValue([])
  const administrators: AdministratorRouteDependencies = {
    applicationOrigin,
    cancel,
    continue: continueAuthorization,
    findSession,
    getAuthorization,
    list,
    listSecurityAudits,
    search,
    start: { entra: entra.dependencies, github: github.dependencies },
  }
  const authentication: AuthenticationRouteDependencies = {
    administrators,
    currentSession: { restore: vi.fn() },
    signOut: {
      applicationOrigin,
      end: vi.fn(),
      secureCookie: false,
    },
  }
  return {
    administrators,
    authentication,
    cancel,
    continueAuthorization,
    entra,
    findSession,
    getAuthorization,
    github,
    list,
    search,
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

describe("administratorRoutes()", () => {
  it("requires a live administrator session before listing data", async () => {
    const { authentication, findSession, list } = routeDependencies()
    findSession.mockResolvedValueOnce(null)

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(403)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(findSession).toHaveBeenCalledWith(
        createHash("sha256").update(sessionValue).digest("hex"),
      )
      expect(list).not.toHaveBeenCalled()
    })
  })

  it("round-trips the bounded administrator cursor", async () => {
    const { authentication, list } = routeDependencies()
    const cursor = { createdAt: new Date("2026-11-09T20:00:00Z"), membershipId: randomUUID() }
    list.mockResolvedValueOnce({
      administrators: [{ membershipId: randomUUID() }],
      nextCursor: cursor,
    })

    await withServer(authentication, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/administrators?limit=1`, {
        headers: sessionHeaders(),
      })
      expect(first.status).toBe(200)
      const firstBody = (await first.json()) as { nextCursor: string }

      const second = await fetch(
        `${baseUrl}/api/administrators?limit=1&before=${encodeURIComponent(firstBody.nextCursor)}`,
        { headers: sessionHeaders() },
      )

      expect(second.status).toBe(200)
      expect(list).toHaveBeenNthCalledWith(1, { before: undefined, limit: 1 })
      expect(list).toHaveBeenNthCalledWith(2, { before: cursor, limit: 1 })
    })
  })

  it("rejects an invalid administrator cursor before listing", async () => {
    const { authentication, list } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators?before=not-a-cursor`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(400)
      expect(list).not.toHaveBeenCalled()
    })
  })

  it("passes a trimmed candidate search without exposing effective administrators by default", async () => {
    const { authentication, search } = routeDependencies()
    search.mockResolvedValueOnce([
      { login: "octocat", membershipId: randomUUID(), name: "The Octocat", provider: "github" },
    ])

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/administrators/candidates?query=%20octo%20&limit=5`,
        { headers: sessionHeaders() },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        candidates: [{ login: "octocat", name: "The Octocat" }],
      })
      expect(search).toHaveBeenCalledWith({ limit: 5, query: "octo" })
    })
  })

  it("does not fall back to another provider for fresh authorization", async () => {
    const { administrators, authentication, entra } = routeDependencies()
    administrators.start.github = undefined
    const targetMembershipId = randomUUID()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({
          operation: "REVOKE_ADMINISTRATOR",
          targetMembershipIds: [targetMembershipId],
        }),
        redirect: "manual",
      })

      expect(response.status).toBe(409)
      expect(entra.start).not.toHaveBeenCalled()
    })
  })

  it("binds fresh authorization to the live session, identity, operation, and targets", async () => {
    const { authentication, github } = routeDependencies()
    const targetMembershipIds = [randomUUID(), randomUUID()]

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({
          operation: "DESIGNATE_ADMINISTRATORS",
          targetMembershipIds,
        }),
        redirect: "manual",
      })

      expect(response.status).toBe(200)
      const responseBody: unknown = await response.json()
      expect(responseBody).toEqual({
        authorizationId: github.authorizationId,
        authorizationUrl: "https://github.com/login/oauth/authorize",
        expiresAt: "2030-01-01T00:00:00.000Z",
      })
      expect(github.start).toHaveBeenCalledWith({
        actorMembershipId: session.membershipId,
        externalIdentityId: session.externalIdentityId,
        hubSessionId: session.id,
        operation: "DESIGNATE_ADMINISTRATORS",
        targetMembershipIds,
      })
    })
  })

  it("rate-limits fresh authorization before starting provider work", async () => {
    const { authentication, github } = routeDependencies()
    github.checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      auditFailed: false,
    })

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({
          operation: "REVOKE_ADMINISTRATOR",
          targetMembershipIds: [randomUUID()],
        }),
      })

      expect(response.status).toBe(429)
      expect(github.checkRateLimit).toHaveBeenCalledOnce()
      expect(github.start).not.toHaveBeenCalled()
    })
  })

  it("retrieves confirmation only for the current live session", async () => {
    const { authentication, getAuthorization } = routeDependencies()
    const authorizationId = randomUUID()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/administrators/authorizations/${authorizationId}`,
        { headers: sessionHeaders() },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toHaveProperty(
        "authorization.operation",
        "REVOKE_ADMINISTRATOR",
      )
      expect(getAuthorization).toHaveBeenCalledWith({
        authorizationId,
        hubSessionId: session.id,
      })
    })
  })

  it("returns gone when fresh authorization can no longer be confirmed", async () => {
    const { authentication, getAuthorization } = routeDependencies()
    getAuthorization.mockResolvedValueOnce(null)

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/${randomUUID()}`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(410)
      expect(await response.json()).toEqual({
        error: "The authorization is no longer available.",
      })
    })
  })

  it("returns an explicit conflict when a continuation is stale or already used", async () => {
    const { authentication, continueAuthorization } = routeDependencies()
    continueAuthorization.mockRejectedValueOnce(new AdministratorAuthorizationDeniedError("used"))

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/continue`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({
          authorizationId: randomUUID(),
          operation: "REVOKE_ADMINISTRATOR",
          targetMembershipIds: [randomUUID()],
        }),
      })

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: "used" })
    })
  })

  it("rejects a cross-origin cancellation before reading the session", async () => {
    const { authentication, cancel, findSession } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/administrators/authorizations/cancel`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: "https://attacker.example",
        }),
        body: JSON.stringify({ authorizationId: randomUUID() }),
      })

      expect(response.status).toBe(403)
      expect(findSession).not.toHaveBeenCalled()
      expect(cancel).not.toHaveBeenCalled()
    })
  })
})
