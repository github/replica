import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import type { AuthenticationRouteRuntime } from "./types"

function runtime(): AuthenticationRouteRuntime {
  const start = vi.fn()
  const checkRateLimit = vi.fn().mockResolvedValue(true)
  const verifyBootstrapSecret = vi.fn().mockReturnValue(false)
  const authentication: AuthenticationRouteRuntime = {
    applicationOrigin: "http://127.0.0.1:5173",
    secureCookie: false,
    start,
    complete: vi.fn(),
    admit: vi.fn(),
    restore: vi.fn(),
    end: vi.fn(),
    checkRateLimit,
    verifyBootstrapSecret,
    writeBootstrapDenial: vi.fn().mockResolvedValue(undefined),
  }
  return Object.assign(authentication, {
    testDoubles: { checkRateLimit, start, verifyBootstrapSecret },
  })
}

async function withServer(
  authentication: AuthenticationRouteRuntime,
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
    const authentication = runtime()
    const testDoubles = (
      authentication as AuthenticationRouteRuntime & {
        testDoubles: {
          checkRateLimit: ReturnType<typeof vi.fn>
          start: ReturnType<typeof vi.fn>
          verifyBootstrapSecret: ReturnType<typeof vi.fn>
        }
      }
    ).testDoubles
    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/start`, {
        method: "POST",
        headers: { origin: "https://attacker.example" },
      })

      expect(response.status).toBe(403)
      expect(testDoubles.checkRateLimit).not.toHaveBeenCalled()
      expect(testDoubles.start).not.toHaveBeenCalled()
    })
  })

  it("rate-limits an enrollment before parsing its secret", async () => {
    const authentication = runtime()
    const testDoubles = (
      authentication as AuthenticationRouteRuntime & {
        testDoubles: {
          checkRateLimit: ReturnType<typeof vi.fn>
          start: ReturnType<typeof vi.fn>
          verifyBootstrapSecret: ReturnType<typeof vi.fn>
        }
      }
    ).testDoubles
    testDoubles.checkRateLimit.mockResolvedValue(false)
    await withServer(authentication, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/auth/github/admin-enrollment/start`, {
        method: "POST",
        headers: {
          origin: authentication.applicationOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "bootstrap_secret=payload-secret",
      })

      expect(response.status).toBe(429)
      expect(testDoubles.verifyBootstrapSecret).not.toHaveBeenCalled()
      expect(testDoubles.start).not.toHaveBeenCalled()
    })
  })
})
