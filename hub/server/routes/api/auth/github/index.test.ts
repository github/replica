import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { createLogger } from "../../../../integrations/pino/create-logger"
import { createBoundedRateLimiter } from "../../../../utils/authentication/create-bounded-rate-limiter"
import type { GitHubAuthenticationRoutesDependencies } from "./types"

async function openServer(dependencies: GitHubAuthenticationRoutesDependencies) {
  const records: string[] = []
  const server = createServer(
    createApp({
      githubAuthentication: dependencies,
      logger: createLogger({ destination: { write: (line) => records.push(line) } }),
      trustedProxyHops: 1,
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  return {
    records,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  }
}

function dependencies() {
  const complete = vi.fn(() =>
    Promise.resolve({
      status: "authentication_proved" as const,
      handoffToken: "handoff-secret",
      expiresAt: new Date("2026-10-30T16:05:00Z"),
      attributes: {
        login: "octocat",
        name: null,
        avatarUrl: null,
        email: null,
      },
    }),
  )
  const start = vi.fn(() =>
    Promise.resolve({
      authorizationUrl:
        "https://github.com/login/oauth/authorize?state=state-secret&code_challenge=challenge",
      browserBinding: "browser-binding-secret",
      expiresAt: new Date("2026-10-30T16:10:00Z"),
    }),
  )
  return {
    complete,
    start,
    value: {
      appOrigin: "https://hub.example.test",
      callbackRateLimiter: createBoundedRateLimiter({
        limit: 20,
        maxKeys: 100,
        windowMs: 60_000,
      }),
      complete,
      now: () => new Date("2026-10-30T16:00:00Z"),
      secureCookies: true,
      start,
    } satisfies GitHubAuthenticationRoutesDependencies,
  }
}

describe("GitHub authentication routes", () => {
  it("starts only from the configured origin and sets a bounded browser cookie", async () => {
    const { start, value } = dependencies()
    const { baseUrl } = await openServer(value)

    const denied = await fetch(`${baseUrl}/api/auth/github/start`, {
      method: "POST",
      headers: { origin: "https://attacker.example.test" },
      redirect: "manual",
    })
    expect(denied.status).toBe(403)
    expect(denied.headers.get("cache-control")).toBe("no-store")
    expect(start).not.toHaveBeenCalled()

    const response = await fetch(`${baseUrl}/api/auth/github/start`, {
      method: "POST",
      headers: {
        origin: "https://hub.example.test",
        "x-forwarded-for": "192.0.2.10",
      },
      redirect: "manual",
    })
    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toContain("github.com/login/oauth/authorize")
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("set-cookie")).toMatch(
      /^hub_auth_browser=browser-binding-secret; Path=\/api\/auth; Expires=.*; HttpOnly; Secure; SameSite=Lax$/,
    )
    expect(start).toHaveBeenCalledWith({ requestIp: "192.0.2.10" })
  })

  it("returns a non-admitted handoff and excludes callback secrets from HTTP logs", async () => {
    const { complete, value } = dependencies()
    const { baseUrl, records } = await openServer(value)
    const response = await fetch(
      `${baseUrl}/api/auth/github/callback?code=authorization-code-secret&state=${"s".repeat(32)}`,
      {
        headers: {
          cookie: "hub_auth_browser=browser-binding-secret",
          "x-forwarded-for": "192.0.2.10",
        },
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(await response.json()).toEqual({
      status: "authentication_proved",
      admission: "pending",
      handoffToken: "handoff-secret",
      expiresAt: "2026-10-30T16:05:00.000Z",
      identity: {
        login: "octocat",
        name: null,
        avatarUrl: null,
        email: null,
      },
    })
    expect(complete).toHaveBeenCalledWith({
      browserBinding: "browser-binding-secret",
      code: "authorization-code-secret",
      state: "s".repeat(32),
    })
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records.join("")).not.toMatch(
      /authorization-code-secret|browser-binding-secret|handoff-secret/,
    )
  })

  it("rejects malformed, oversized, and rate-limited callbacks before proof completion", async () => {
    const { complete, value } = dependencies()
    value.callbackRateLimiter = createBoundedRateLimiter({
      limit: 1,
      maxKeys: 100,
      windowMs: 60_000,
    })
    const { baseUrl } = await openServer(value)

    const malformed = await fetch(
      `${baseUrl}/api/auth/github/callback?code=${"x".repeat(1_001)}&state=short`,
      { headers: { cookie: "hub_auth_browser=binding", "x-forwarded-for": "192.0.2.10" } },
    )
    expect(malformed.status).toBe(400)
    const limited = await fetch(
      `${baseUrl}/api/auth/github/callback?code=code&state=${"s".repeat(32)}`,
      {
        headers: {
          cookie: "hub_auth_browser=browser-binding-secret",
          "x-forwarded-for": "192.0.2.10",
        },
      },
    )
    expect(limited.status).toBe(429)
    expect(complete).not.toHaveBeenCalled()
  })
})
