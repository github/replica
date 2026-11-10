import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import type { AdministratorRouteDependencies, AuthenticationRouteDependencies } from "../auth/types"

const applicationOrigin = "http://127.0.0.1:5173"
const sessionValue = "current-session"
const session = {
  externalIdentityId: randomUUID(),
  id: randomUUID(),
  membershipId: randomUUID(),
  providerKey: "github",
}

function routeDependencies() {
  const findSession = vi.fn().mockResolvedValue(session)
  const listSecurityAudits = vi
    .fn<AdministratorRouteDependencies["listSecurityAudits"]>()
    .mockResolvedValue({ records: [], nextCursor: null })
  const administrators: AdministratorRouteDependencies = {
    applicationOrigin,
    cancel: vi.fn(),
    continue: vi.fn(),
    findSession,
    getAuthorization: vi.fn(),
    list: vi.fn(),
    listSecurityAudits,
    search: vi.fn(),
    start: { entra: undefined, github: undefined },
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
  return { authentication, findSession, listSecurityAudits }
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

function sessionHeaders() {
  return { cookie: `hub_session=${sessionValue}` }
}

describe("securityAuditRoutes()", () => {
  it("does not read audits without a session cookie", async () => {
    const { authentication, findSession, listSecurityAudits } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits`)

      expect(response.status).toBe(403)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(findSession).not.toHaveBeenCalled()
      expect(listSecurityAudits).not.toHaveBeenCalled()
    })
  })

  it("does not read audits when the current session is stale or lacks administrator authority", async () => {
    const { authentication, findSession, listSecurityAudits } = routeDependencies()
    findSession.mockResolvedValueOnce(null)

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(403)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(findSession).toHaveBeenCalledWith(
        createHash("sha256").update(sessionValue).digest("hex"),
      )
      expect(listSecurityAudits).not.toHaveBeenCalled()
    })
  })

  it("uses the default and maximum page size without allowing response storage", async () => {
    const { authentication, listSecurityAudits } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const defaultResponse = await fetch(`${baseUrl}/api/security-audits`, {
        headers: sessionHeaders(),
      })
      const maximumResponse = await fetch(`${baseUrl}/api/security-audits?limit=50`, {
        headers: sessionHeaders(),
      })

      expect(defaultResponse.status).toBe(200)
      expect(defaultResponse.headers.get("cache-control")).toBe("no-store")
      expect(await defaultResponse.json()).toEqual({ records: [], nextCursor: null })
      expect(maximumResponse.status).toBe(200)
      expect(maximumResponse.headers.get("cache-control")).toBe("no-store")
      expect(listSecurityAudits).toHaveBeenNthCalledWith(1, {
        before: undefined,
        limit: 50,
      })
      expect(listSecurityAudits).toHaveBeenNthCalledWith(2, {
        before: undefined,
        limit: 50,
      })
    })
  })

  it.each([
    ["empty", "limit="],
    ["below the minimum", "limit=0"],
    ["non-integer", "limit=1.5"],
    ["noncanonical", "limit=01"],
    ["structurally repeated", "limit=1&limit=2"],
  ])("rejects a %s limit before reading audits", async (_label, query) => {
    const { authentication, listSecurityAudits } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits?${query}`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(400)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(listSecurityAudits).not.toHaveBeenCalled()
    })
  })

  it("explains the maximum page size before reading audits", async () => {
    const { authentication, listSecurityAudits } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits?limit=51`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: "The security audit limit exceeds the maximum of 50.",
      })
      expect(listSecurityAudits).not.toHaveBeenCalled()
    })
  })

  it("rejects repository scoping because the audit list is Hub-wide", async () => {
    const { authentication, listSecurityAudits } = routeDependencies()

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits?repositoryId=${randomUUID()}`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(400)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(listSecurityAudits).not.toHaveBeenCalled()
    })
  })

  it("round-trips an opaque cursor and rejects invalid cursor forms before reading", async () => {
    const { authentication, listSecurityAudits } = routeDependencies()
    const cursor = { createdAt: new Date("2026-11-10T12:00:00.000Z"), id: randomUUID() }
    listSecurityAudits
      .mockResolvedValueOnce({ records: [], nextCursor: cursor })
      .mockResolvedValueOnce({ records: [], nextCursor: null })

    await withServer(authentication, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/security-audits?limit=1`, {
        headers: sessionHeaders(),
      })
      const firstBody = (await first.json()) as { nextCursor: string }
      const second = await fetch(
        `${baseUrl}/api/security-audits?limit=1&before=${encodeURIComponent(firstBody.nextCursor)}`,
        { headers: sessionHeaders() },
      )

      expect(second.status).toBe(200)
      expect(listSecurityAudits).toHaveBeenNthCalledWith(2, { before: cursor, limit: 1 })

      const structurallyInvalid = Buffer.from(
        JSON.stringify({
          createdAt: cursor.createdAt.toISOString(),
          extra: true,
          id: cursor.id,
          version: 1,
        }),
      ).toString("base64url")
      const invalidCursors = [
        "not-a-cursor",
        "a".repeat(501),
        structurallyInvalid,
        `${firstBody.nextCursor}=`,
      ]
      for (const invalidCursor of invalidCursors) {
        const response = await fetch(
          `${baseUrl}/api/security-audits?before=${encodeURIComponent(invalidCursor)}`,
          { headers: sessionHeaders() },
        )
        expect(response.status).toBe(400)
        expect(response.headers.get("cache-control")).toBe("no-store")
      }
      expect(listSecurityAudits).toHaveBeenCalledTimes(2)
    })
  })

  it("returns typed records without exposing unknown or secret-like stored context", async () => {
    const { authentication, listSecurityAudits } = routeDependencies()
    const membershipId = randomUUID()
    const occurredAt = new Date("2026-11-10T12:00:00.000Z")
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    const sessionTargetId = randomUUID()
    const providerTargetId = randomUUID()
    listSecurityAudits.mockResolvedValueOnce({
      nextCursor: null,
      records: [
        {
          action: "session.created",
          context: { membershipId },
          createdAt: occurredAt,
          id: ids[0]!,
          outcome: "SUCCESS",
          targetId: sessionTargetId,
        },
        {
          action: "admission.denied",
          context: { reason: "membership_missing" },
          createdAt: occurredAt,
          id: ids[1]!,
          outcome: "DENIED",
          targetId: null,
        },
        {
          action: "admission.failed",
          context: { reason: "transaction_error" },
          createdAt: occurredAt,
          id: ids[2]!,
          outcome: "FAILURE",
          targetId: null,
        },
        {
          action: "unknown.future.action",
          context: { accessToken: "must-not-leave-storage" },
          createdAt: occurredAt,
          id: ids[3]!,
          outcome: null,
          targetId: null,
        },
        {
          action: "identity.provider_revision.selected",
          context: { provider: "custom+提供者", revision: 3 },
          createdAt: occurredAt,
          id: ids[4]!,
          outcome: "SUCCESS",
          targetId: providerTargetId,
        },
      ],
    })

    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/security-audits`, {
        headers: sessionHeaders(),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        nextCursor: null,
        records: [
          {
            action: "session.created",
            actor: { membershipId },
            context: { targetId: sessionTargetId },
            id: ids[0],
            occurredAt: occurredAt.toISOString(),
            outcome: "success",
          },
          {
            action: "admission.denied",
            actor: null,
            context: { reason: "membership_missing" },
            id: ids[1],
            occurredAt: occurredAt.toISOString(),
            outcome: "denied",
          },
          {
            action: "admission.failed",
            actor: null,
            context: { reason: "transaction_error" },
            id: ids[2],
            occurredAt: occurredAt.toISOString(),
            outcome: "failure",
          },
          {
            action: "unknown.future.action",
            actor: null,
            context: {},
            id: ids[3],
            occurredAt: occurredAt.toISOString(),
            outcome: null,
          },
          {
            action: "identity.provider_revision.selected",
            actor: null,
            context: {
              provider: "custom+提供者",
              revision: 3,
              targetId: providerTargetId,
            },
            id: ids[4],
            occurredAt: occurredAt.toISOString(),
            outcome: "success",
          },
        ],
      })
    })
  })
})
