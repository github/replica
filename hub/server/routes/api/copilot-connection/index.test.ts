import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import type {
  AuthenticationRouteDependencies,
  StartAdministratorAuthorizationDependencies,
} from "../auth/types"
import type { CopilotConnectionRouteDependencies } from "./types"

const applicationOrigin = "http://127.0.0.1:5173"
const sessionValue = "current-session"
const session = {
  externalIdentityId: randomUUID(),
  id: randomUUID(),
  membershipId: randomUUID(),
  providerKey: "github",
}

function startDependencies() {
  const start = vi.fn().mockResolvedValue({
    authorizationId: randomUUID(),
    authorizationUrl: "https://github.com/login/oauth/authorize",
    browserBinding: "browser-binding-with-required-length",
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  })
  const dependencies: StartAdministratorAuthorizationDependencies = {
    applicationOrigin,
    checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, auditFailed: false }),
    secureCookie: false,
    start,
  }
  return { dependencies, start }
}

function routeDependencies() {
  const cancel = vi.fn().mockResolvedValue(true)
  const continueAuthorization = vi
    .fn<NonNullable<CopilotConnectionRouteDependencies["continueAuthorization"]>>()
    .mockResolvedValue({ connectionId: randomUUID() })
  const findSession = vi.fn().mockResolvedValue(session)
  const getAuthorization = vi.fn().mockResolvedValue({
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    operation: "CONNECT_COPILOT",
    verifiedAt: new Date("2029-12-31T23:59:00Z"),
  })
  const status = vi.fn().mockResolvedValue({
    configured: true,
    connected: false,
    savedConnection: false,
    connectedBy: null,
    refusedAt: null,
    verifiedAt: null,
  })
  const github = startDependencies()
  const copilotConnection: CopilotConnectionRouteDependencies = {
    applicationOrigin,
    authorization: {
      cancel,
      findSession,
      getAuthorization,
      start: { github: github.dependencies },
    },
    continueAuthorization,
    findSession,
    getGeneration: vi.fn().mockResolvedValue(7n),
    status,
  }
  const authentication: AuthenticationRouteDependencies = {
    currentSession: { restore: vi.fn() },
    signOut: { applicationOrigin, end: vi.fn(), secureCookie: false },
  }
  return {
    authentication,
    cancel,
    continueAuthorization,
    copilotConnection,
    findSession,
    getAuthorization,
    status,
    github,
  }
}

async function withServer(
  authentication: AuthenticationRouteDependencies,
  copilotConnection: CopilotConnectionRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
) {
  const server = createServer(createApp({ authentication, copilotConnection }))
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

describe("copilotConnectionRoutes()", () => {
  it("requires a live effective administrator before exposing connection state", async () => {
    const { authentication, copilotConnection, findSession, status } = routeDependencies()
    findSession.mockResolvedValueOnce(null)

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(403)
      expect(findSession).toHaveBeenCalledWith(
        createHash("sha256").update(sessionValue).digest("hex"),
      )
      expect(status).not.toHaveBeenCalled()
    })
  })

  it("returns connection provenance without returning the operator token or digest", async () => {
    const { authentication, copilotConnection, status } = routeDependencies()
    const verifiedAt = new Date("2029-12-30T12:00:01Z")
    status.mockResolvedValueOnce({
      configured: true,
      connected: true,
      savedConnection: true,
      credentialIdentity: null,
      connectedBy: {
        login: "octocat",
        membershipId: session.membershipId,
        name: "The Octocat",
      },
      refusedAt: null,
      verifiedAt,
    })

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection`, {
        headers: sessionHeaders(),
      })
      const body: unknown = await response.json()

      expect(response.status).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(body).toEqual({
        configured: true,
        connected: true,
        savedConnection: true,
        credentialIdentity: null,
        connectedBy: {
          login: "octocat",
          membershipId: session.membershipId,
          name: "The Octocat",
        },
        refusedAt: null,
        verifiedAt: verifiedAt.toISOString(),
      })
    })
  })

  it("requires explicit confirmation and binds fresh authorization to the saved generation", async () => {
    const { authentication, copilotConnection, github } = routeDependencies()

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/api/copilot-connection/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({ "content-type": "application/json", origin: applicationOrigin }),
        body: JSON.stringify({ operation: "CONNECT_COPILOT" }),
      })

      expect(denied.status).toBe(400)
      expect(github.start).not.toHaveBeenCalled()

      const response = await fetch(`${baseUrl}/api/copilot-connection/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({ "content-type": "application/json", origin: applicationOrigin }),
        body: JSON.stringify({ confirmed: true, operation: "CONNECT_COPILOT" }),
      })

      expect(response.status).toBe(200)
      expect(github.start).toHaveBeenCalledWith({
        actorMembershipId: session.membershipId,
        expectedCopilotGeneration: 7n,
        externalIdentityId: session.externalIdentityId,
        hubSessionId: session.id,
        operation: "CONNECT_COPILOT",
        targetMembershipIds: [session.membershipId],
      })
    })
  })

  it.each([
    [
      "rechecks a healthy saved connection",
      "CONNECT_COPILOT" as const,
      { connected: true, savedConnection: true },
    ],
    [
      "disconnects an inactive saved connection",
      "DISCONNECT_COPILOT" as const,
      { connected: false, savedConnection: true },
    ],
  ])("%s", async (_label, operation, statusOverride) => {
    const { authentication, copilotConnection, github, status } = routeDependencies()
    status.mockResolvedValue({
      configured: true,
      connectedBy: null,
      refusedAt: null,
      verifiedAt: new Date(),
      ...statusOverride,
    })

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({ "content-type": "application/json", origin: applicationOrigin }),
        body: JSON.stringify({ confirmed: true, operation }),
      })

      expect(response.status).toBe(200)
      expect(github.start).toHaveBeenCalledWith(
        expect.objectContaining({
          operation,
        }),
      )
    })
  })

  it("uses the local session provider for fresh authorization", async () => {
    const { authentication, copilotConnection } = routeDependencies()
    const local = startDependencies()
    copilotConnection.authorization!.findSession = vi.fn().mockResolvedValue({
      ...session,
      providerKey: "local",
    })
    copilotConnection.authorization!.start.local = local.dependencies

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/copilot-connection/authorizations/start`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ confirmed: true, operation: "CONNECT_COPILOT" }),
      })

      expect(response.status).toBe(200)
      expect(local.start).toHaveBeenCalledWith(
        expect.objectContaining({
          actorMembershipId: session.membershipId,
          operation: "CONNECT_COPILOT",
        }),
      )
    })
  })

  it("continues and cancels only through the current administrator session", async () => {
    const { authentication, cancel, continueAuthorization, copilotConnection } = routeDependencies()
    const authorizationId = randomUUID()

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const continued = await fetch(`${baseUrl}/api/copilot-connection/authorizations/continue`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({ authorizationId, operation: "DISCONNECT_COPILOT" }),
      })
      const cancelled = await fetch(`${baseUrl}/api/copilot-connection/authorizations/cancel`, {
        method: "POST",
        headers: sessionHeaders({ "content-type": "application/json", origin: applicationOrigin }),
        body: JSON.stringify({ authorizationId }),
      })

      expect(continued.status).toBe(200)
      expect(continueAuthorization).toHaveBeenCalledOnce()
      const continuation = continueAuthorization.mock.calls[0]![0]
      expect(continuation).toMatchObject({
        authorizationId,
        hubSessionId: session.id,
        operation: "DISCONNECT_COPILOT",
        sessionDigest: createHash("sha256").update(sessionValue).digest("hex"),
      })
      expect(continuation.signal).toBeInstanceOf(AbortSignal)
      expect(cancelled.status).toBe(204)
      expect(cancel).toHaveBeenCalledWith({ authorizationId, hubSessionId: session.id })
    })
  })

  it("applies the authorization parser limit before case-insensitive route handling", async () => {
    const { authentication, copilotConnection, github } = routeDependencies()

    await withServer(authentication, copilotConnection, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/API/COPILOT-CONNECTION/AUTHORIZATIONS/START`, {
        method: "POST",
        headers: sessionHeaders({
          "content-type": "application/json",
          origin: applicationOrigin,
        }),
        body: JSON.stringify({
          confirmed: true,
          operation: "CONNECT_COPILOT",
          padding: "x".repeat(5_000),
        }),
      })

      expect(response.status).toBe(413)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(github.start).not.toHaveBeenCalled()
    })
  })
})
