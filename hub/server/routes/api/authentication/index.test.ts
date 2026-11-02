import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import type { AuthenticationRouteDependencies } from "./types"

function routeDependencies() {
  const checkRateLimit = vi.fn().mockResolvedValue(true)
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
      writeRateLimitDenial: vi.fn().mockResolvedValue(undefined),
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
    checkRateLimit.mockResolvedValue(false)
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
})
