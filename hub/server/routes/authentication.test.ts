import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import type { Mocked } from "vitest"

import type { AuthenticationService } from "#server/domains/authentication/create-service/types"
import type { AuthenticationRoutes } from "#server/routes/types"
import { createLogger } from "#server/integrations/pino/create-logger"
import { AuthenticationError } from "#server/utils/authentication-error"

import { createApp } from "../create-app/index.ts"

function authentication(
  overrides: Partial<Mocked<AuthenticationService>> = {},
  secureCookies = true,
  trustedProxyHops = 0,
) {
  const service = Object.assign(
    {
      start: vi.fn().mockResolvedValue({
        authorizationUrl: "https://github.com/login/oauth/authorize?state=redacted",
        browserToken: "browser-token",
      }),
      complete: vi.fn().mockResolvedValue({
        purpose: "sign-in",
        sessionToken: "session-token",
      }),
      current: vi
        .fn()
        .mockRejectedValue(
          new AuthenticationError(401, "sign_in_required", "Sign in to continue."),
        ),
      signOut: vi.fn().mockResolvedValue(undefined),
      revokeAll: vi.fn().mockResolvedValue(undefined),
    },
    overrides,
  )
  return {
    settings: {
      origin: "https://hub.example",
      secureCookies,
      configured: true,
      admissionPolicy: "hub-managed" as const,
      trustedProxyHops,
    },
    service,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

async function serve(runtime: AuthenticationRoutes, logger = createLogger()) {
  const server = createServer(createApp({ authentication: runtime, logger }))
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

const csrfToken = "c".repeat(43)
const sessionToken = "s".repeat(43)
const browserToken = "b".repeat(43)
const csrfHeaders = {
  origin: "https://hub.example",
  cookie: `__Host-replica-csrf=${csrfToken}; __Host-replica-session=${sessionToken}`,
  "x-csrf-token": csrfToken,
}

describe("authentication routes", () => {
  it("sets host-bound secure cookies and omits repository scope during GitHub initiation", async () => {
    const runtime = authentication({
      start: vi.fn().mockResolvedValue({
        authorizationUrl:
          "https://github.com/login/oauth/authorize?client_id=client&state=state&code_challenge=challenge&code_challenge_method=S256",
        browserToken,
      }),
    })
    const baseUrl = await serve(runtime)

    const response = await fetch(`${baseUrl}/api/auth/github`, {
      method: "POST",
      headers: csrfHeaders,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authorizationUrl:
        "https://github.com/login/oauth/authorize?client_id=client&state=state&code_challenge=challenge&code_challenge_method=S256",
    })
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(
        `__Host-replica-authorization=${browserToken}; Max-Age=600; Path=/; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax`,
        "i",
      ),
    )
    expect(runtime.service.start).toHaveBeenCalledWith("sign-in")
  })

  it("rejects state-changing requests unless both the origin and CSRF token match", async () => {
    const runtime = authentication()
    const baseUrl = await serve(runtime)

    const wrongOrigin = await fetch(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: { ...csrfHeaders, origin: "https://attacker.example" },
    })
    expect(wrongOrigin.status).toBe(403)
    expect(await wrongOrigin.json()).toEqual({ error: "Request not allowed" })

    const wrongCsrf = await fetch(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: { ...csrfHeaders, "x-csrf-token": "wrong-token" },
    })
    expect(wrongCsrf.status).toBe(403)
    expect(await wrongCsrf.json()).toEqual({ error: "Request not allowed" })
    expect(runtime.service.signOut).not.toHaveBeenCalled()
  })

  it("omits rejected auth payloads before origin middleware can finish the request", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: {
        write: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      },
    })
    const runtime = authentication()
    const baseUrl = await serve(runtime, logger)

    const response = await fetch(`${baseUrl}/api/auth/github?note=query-private-value`, {
      method: "POST",
      headers: {
        ...csrfHeaders,
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ note: "body-private-value" }),
    })

    expect(response.status).toBe(403)
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).not.toHaveProperty("query")
    expect(records[0]).not.toHaveProperty("body")
    expect(JSON.stringify(records)).not.toMatch(/query-private-value|body-private-value/)
  })

  it("rotates browser state on sign-out and delegates revoke-all only with a protected request", async () => {
    const runtime = authentication()
    const baseUrl = await serve(runtime)

    const signOut = await fetch(`${baseUrl}/api/session`, {
      method: "DELETE",
      headers: csrfHeaders,
    })
    expect(signOut.status).toBe(204)
    expect(runtime.service.signOut).toHaveBeenCalledWith(sessionToken)
    const signOutCookies = signOut.headers.get("set-cookie") ?? ""
    expect(signOutCookies).toContain("__Host-replica-session=")
    expect(signOutCookies).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT")
    expect(signOutCookies).toMatch(/__Host-replica-csrf=[\w-]{43}/)

    const revokeAll = await fetch(`${baseUrl}/api/session/revoke-all`, {
      method: "POST",
      headers: csrfHeaders,
    })
    expect(revokeAll.status).toBe(204)
    expect(runtime.service.revokeAll).toHaveBeenCalledWith(sessionToken)
  })

  it("redirects callback failures generically and never logs OAuth secrets", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: {
        write: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      },
    })
    const runtime = authentication({
      complete: vi
        .fn()
        .mockRejectedValue(
          new AuthenticationError(
            401,
            "invalid_authorization",
            "private callback failure containing a token",
          ),
        ),
    })
    const baseUrl = await serve(runtime, logger)
    const state = "s".repeat(43)

    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=private-code&state=${state}`,
      {
        headers: { cookie: `__Host-replica-authorization=${browserToken}` },
        redirect: "manual",
      },
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("https://hub.example/?authentication=failed")
    expect(response.headers.get("set-cookie")).toMatch(
      /__Host-replica-authorization=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax/i,
    )
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(JSON.stringify(records)).not.toMatch(
      /private-code|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb|callback failure|token/,
    )
  })

  it("allows the initiation limit and rejects the next request without calling the service", async () => {
    const runtime = authentication()
    const baseUrl = await serve(runtime)

    const responses = []
    for (let request = 0; request < 21; request++) {
      responses.push(
        await fetch(`${baseUrl}/api/auth/github`, {
          method: "POST",
          headers: {
            ...csrfHeaders,
            "x-forwarded-for": `198.51.100.${request + 1}`,
          },
        }),
      )
    }

    expect(responses.slice(0, 20).every(({ status }) => status === 200)).toBe(true)
    const limitedResponse = responses[20]
    expect(limitedResponse).toBeDefined()
    expect(limitedResponse!.status).toBe(429)
    expect(await limitedResponse!.json()).toEqual({ error: "Too many requests" })
    expect(runtime.service.start).toHaveBeenCalledTimes(20)
  })

  it("separates rate limits by forwarded client only behind the configured proxy boundary", async () => {
    const runtime = authentication({}, true, 1)
    const baseUrl = await serve(runtime)

    const responses = []
    for (let request = 0; request < 20; request++) {
      responses.push(
        await fetch(`${baseUrl}/api/auth/github`, {
          method: "POST",
          headers: {
            ...csrfHeaders,
            "x-forwarded-for": "198.51.100.10",
          },
        }),
      )
    }
    responses.push(
      await fetch(`${baseUrl}/api/auth/github`, {
        method: "POST",
        headers: {
          ...csrfHeaders,
          "x-forwarded-for": "203.0.113.20",
        },
      }),
    )

    expect(responses.every(({ status }) => status === 200)).toBe(true)
    expect(runtime.service.start).toHaveBeenCalledTimes(21)
  })

  it("returns session state without exposing the session token and creates a readable CSRF cookie", async () => {
    const runtime = authentication({
      current: vi.fn().mockResolvedValue({
        id: "session",
        userId: "user",
        externalIdentityId: "identity",
        authenticationProviderRevisionId: "revision",
        tokenDigest: "stored-digest",
        signedInAt: new Date("2026-10-27T18:00:00.000Z"),
        freshAuthorizedAt: null,
        user: { id: "user", displayName: "The Octocat", avatarUrl: null },
        externalIdentity: {
          id: "identity",
          userId: "user",
          provider: "github",
          issuer: "https://github.com",
          subject: "42",
          username: "octocat",
          displayName: "The Octocat",
          avatarUrl: null,
        },
        authenticationProviderRevision: {
          id: "revision",
          authenticationProviderId: "provider",
          revision: 1,
          issuer: "https://github.com",
          configuration: {},
          authenticationProvider: {
            id: "provider",
            key: "github",
            type: "github",
            enabled: true,
          },
        },
        membership: null,
      }),
    })
    const baseUrl = await serve(runtime)

    const response = await fetch(`${baseUrl}/api/session`, {
      headers: { cookie: `__Host-replica-session=${sessionToken}` },
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      authenticated: true,
      configured: true,
      admissionPolicy: "hub-managed",
      user: { id: "user", provider: "github", username: "octocat" },
      session: { id: "session", freshAuthorizedAt: null },
    })
    expect(isRecord(body) ? body.csrfToken : undefined).toMatch(/^[\w-]{43}$/)
    expect(response.headers.get("set-cookie")).toMatch(
      /__Host-replica-csrf=[\w-]{43}; Path=\/; Secure; SameSite=Lax/i,
    )
    expect(response.headers.get("set-cookie")).not.toContain("HttpOnly")
    expect(JSON.stringify(body)).not.toContain(sessionToken)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })
})
