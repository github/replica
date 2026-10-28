import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import type { Mocked } from "vitest"

import type { AdministrationService } from "#server/domains/administration/create-service/types"
import type { AuthenticationService } from "#server/domains/authentication/create-service/types"
import type { PrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service/types"
import type { AuthenticationRoutes } from "#server/routes/types"
import { AuthenticationError } from "#server/utils/authentication-error"

import { createApp } from "../create-app/index.ts"

const csrfToken = "c".repeat(43)
const sessionToken = "s".repeat(43)
const protectedHeaders = {
  origin: "https://hub.example",
  cookie: `__Host-replica-csrf=${csrfToken}; __Host-replica-session=${sessionToken}`,
  "content-type": "application/json",
  "x-csrf-token": csrfToken,
}

function runtime(
  overrides: Partial<Mocked<AdministrationService>> = {},
): AuthenticationRoutes & { administration: Mocked<AdministrationService> } {
  const service = {
    start: vi.fn(),
    complete: vi.fn(),
    current: vi.fn(),
    signOut: vi.fn(),
    revokeAll: vi.fn(),
  } as unknown as Mocked<AuthenticationService>
  const administration = Object.assign(
    {
      list: vi.fn().mockResolvedValue({ memberships: [], invitations: [] }),
      invite: vi.fn(),
      revokeInvitation: vi.fn(),
      changeMembership: vi.fn(),
    },
    overrides,
  )
  return {
    service,
    administration,
    prototypeAuthorization: {} as PrototypeAuthorizationService,
    settings: {
      origin: "https://hub.example",
      secureCookies: true,
      configured: true,
      admissionPolicy: "hub-managed",
      trustedProxyHops: 0,
    },
  }
}

async function serve(authentication: AuthenticationRoutes) {
  const server = createServer(createApp({ authentication }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  const { port } = server.address() as AddressInfo
  return `http://127.0.0.1:${port}`
}

describe("administration routes", () => {
  it("returns an explicit authorization failure without leaking the session token", async () => {
    const authentication = runtime({
      list: vi
        .fn()
        .mockRejectedValue(
          new AuthenticationError(
            403,
            "administrator_required",
            "Administrator access is required.",
          ),
        ),
    })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration`, {
      headers: { cookie: `__Host-replica-session=${sessionToken}` },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: "administrator_required",
      message: "Administrator access is required.",
    })
    expect(authentication.administration.list.mock.calls).toEqual([[sessionToken]])
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })

  it.each([
    { name: "missing", origin: undefined },
    { name: "wrong", origin: "https://attacker.example" },
  ])("rejects a $name Origin before an administration mutation runs", async ({ origin }) => {
    const authentication = runtime()
    const baseUrl = await serve(authentication)
    const headers = { ...protectedHeaders }
    if (origin) headers.origin = origin
    else delete (headers as { origin?: string }).origin

    const response = await fetch(`${baseUrl}/api/administration/invitations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        provider: "github",
        issuer: "https://github.com",
        subject: "42",
        role: "member",
      }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Request not allowed" })
    expect(authentication.administration.invite.mock.calls).toEqual([])
  })

  it("rejects membership changes without matching CSRF before calling the service", async () => {
    const authentication = runtime()
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration/memberships/membership`, {
      method: "PATCH",
      headers: { ...protectedHeaders, "x-csrf-token": "wrong-token" },
      body: JSON.stringify({ status: "suspended" }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Request not allowed" })
    expect(authentication.administration.changeMembership.mock.calls).toEqual([])
  })

  it("preserves the last-administrator conflict shape", async () => {
    const authentication = runtime({
      changeMembership: vi
        .fn()
        .mockRejectedValue(
          new AuthenticationError(
            409,
            "last_administrator",
            "The final active administrator cannot be changed.",
          ),
        ),
    })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration/memberships/membership`, {
      method: "PATCH",
      headers: protectedHeaders,
      body: JSON.stringify({ role: "member" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: "last_administrator",
      message: "The final active administrator cannot be changed.",
    })
  })

  it("delegates invitation revocation with the authenticated session", async () => {
    const authentication = runtime({
      revokeInvitation: vi.fn().mockResolvedValue(undefined),
    })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration/invitations/invitation`, {
      method: "DELETE",
      headers: protectedHeaders,
    })

    expect(response.status).toBe(204)
    expect(authentication.administration.revokeInvitation.mock.calls).toEqual([
      [sessionToken, "invitation"],
    ])
  })
})
