import { once } from "node:events"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { createLogger } from "../../../integrations/pino/create-logger"
import type { AuthenticationRouteDependencies } from "./types"

function routeDependencies() {
  const checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, auditFailed: false })
  const startSignIn = vi.fn()
  const startEnrollment = vi.fn()
  const verifyBootstrapSecret = vi.fn().mockReturnValue(false)
  const dependencies: AuthenticationRouteDependencies = {
    signIn: {
      applicationOrigin: "http://127.0.0.1:5173",
      checkRateLimit,
      secureCookie: false,
      start: startSignIn,
    },
    administratorEnrollment: {
      applicationOrigin: "http://127.0.0.1:5173",
      checkRateLimit,
      secureCookie: false,
      start: startEnrollment,
      verifyBootstrapSecret,
      writeBootstrapDenial: vi.fn().mockResolvedValue(undefined),
    },
    callback: {
      checkRateLimit,
      secureCookie: false,
      complete: vi.fn(),
      admit: vi.fn(),
    },
    currentSession: {
      secureCookie: false,
      restore: vi.fn(),
    },
    signOut: {
      applicationOrigin: "http://127.0.0.1:5173",
      secureCookie: false,
      end: vi.fn(),
    },
  }
  return {
    dependencies,
    checkRateLimit,
    startEnrollment,
    startSignIn,
    verifyBootstrapSecret,
  }
}

async function withServer(
  authentication: AuthenticationRouteDependencies,
  operation: (baseUrl: string) => Promise<void>,
  options: Parameters<typeof createApp>[0] = {},
) {
  const server = createServer(createApp({ ...options, authentication }))
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

describe("authenticationRoutes()", () => {
  it("rejects a start from a different origin before provider work", async () => {
    const { dependencies, checkRateLimit, startSignIn } = routeDependencies()
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      })

      expect(response.status).toBe(403)
      expect(checkRateLimit).not.toHaveBeenCalled()
      expect(startSignIn).not.toHaveBeenCalled()
    })
  })

  it("rate-limits an enrollment before parsing its secret", async () => {
    const { dependencies, checkRateLimit, startEnrollment, verifyBootstrapSecret } =
      routeDependencies()
    checkRateLimit.mockResolvedValue({ allowed: false, auditFailed: false })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: dependencies.administratorEnrollment.applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bootstrap_secret=payload-secret",
      })

      expect(response.status).toBe(429)
      expect(verifyBootstrapSecret).not.toHaveBeenCalled()
      expect(startEnrollment).not.toHaveBeenCalled()
    })
  })

  it("uses the trusted proxy address only when the exact hop count is configured", async () => {
    const { dependencies, checkRateLimit } = routeDependencies()
    await withServer(
      dependencies,
      async (baseUrl) => {
        await fetch(`${baseUrl}/api/auth/github/start`, {
          method: "POST",
          headers: {
            origin: dependencies.signIn.applicationOrigin,
            "x-forwarded-for": "203.0.113.7",
          },
          redirect: "manual",
        })

        expect(checkRateLimit).toHaveBeenCalledWith(
          "start",
          createHash("sha256").update("start:203.0.113.7").digest("hex"),
        )
      },
      { trustedProxyHops: 1 },
    )
  })

  it("suppresses callback query and cookie values and disables response storage", async () => {
    const { dependencies } = routeDependencies()
    const records: string[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(line) },
    })
    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await fetch(
          `${baseUrl}/api/auth/github/callback?code=callback-code-secret&state=short`,
          {
            headers: { cookie: "hub_auth_browser=browser-binding-secret" },
            redirect: "manual",
          },
        )

        expect(response.status).toBe(303)
        expect(response.headers.get("cache-control")).toBe("no-store")
        await vi.waitFor(() => expect(records).toHaveLength(1))
        expect(records[0]).not.toMatch(/callback-code-secret|browser-binding-secret|state/)
      },
      { logger },
    )
  })

  it("rate-limits before parsing an oversized enrollment body and suppresses it from logs", async () => {
    const { dependencies, checkRateLimit, verifyBootstrapSecret } = routeDependencies()
    const records: string[] = []
    const logger = createLogger({
      destination: { write: (line) => records.push(line) },
    })
    await withServer(
      dependencies,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
          method: "POST",
          headers: {
            origin: dependencies.administratorEnrollment.applicationOrigin,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: `bootstrap_secret=oversized-secret-${"x".repeat(5_000)}`,
        })

        expect(response.status).toBe(413)
        expect(response.headers.get("cache-control")).toBe("no-store")
        expect(checkRateLimit).toHaveBeenCalledOnce()
        expect(verifyBootstrapSecret).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(records).toHaveLength(1))
        expect(records[0]).not.toContain("oversized-secret")
      },
      { logger },
    )
  })

  it("fails closed when the bootstrap rate-limit denial audit cannot be written", async () => {
    const { dependencies, checkRateLimit, verifyBootstrapSecret } = routeDependencies()
    checkRateLimit.mockResolvedValue({ allowed: false, auditFailed: true })
    await withServer(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: dependencies.administratorEnrollment.applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bootstrap_secret=never-parsed",
      })

      expect(response.status).toBe(429)
      expect(verifyBootstrapSecret).not.toHaveBeenCalled()
    })
  })
})
