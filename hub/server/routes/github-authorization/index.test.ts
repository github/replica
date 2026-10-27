import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import type { Mocked } from "vitest"

import type { AdministrationService } from "#server/domains/administration/create-service/types"
import type { AuthenticationService } from "#server/domains/authentication/create-service/types"
import type { GitHubAuthorizationService } from "#server/domains/github-authorization/create-service/types"
import type { PrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service/types"
import type { AuthenticationRoutes } from "#server/routes/types"

import { createApp } from "../../create-app/index.ts"

const csrfToken = "c".repeat(43)
const sessionToken = "s".repeat(43)
const protectedHeaders = {
  origin: "https://hub.example",
  cookie: `__Host-replica-csrf=${csrfToken}; __Host-replica-session=${sessionToken}`,
  "content-type": "application/json",
  "x-csrf-token": csrfToken,
}

function runtime(
  overrides: Partial<Mocked<GitHubAuthorizationService>> = {},
): AuthenticationRoutes & { githubAuthorization: Mocked<GitHubAuthorizationService> } {
  const githubAuthorization = Object.assign(
    {
      evaluateAdmission: vi.fn(),
      saveAdmissionBaseline: vi.fn(),
      prototypeBaseline: vi.fn(),
      listRepositories: vi.fn().mockResolvedValue([]),
      linkRepository: vi.fn(),
      updateRepository: vi.fn(),
      unlinkRepository: vi.fn(),
      reconcileRepository: vi.fn(),
      reconcileDue: vi.fn(),
      processWebhook: vi.fn(),
    },
    overrides,
  ) as Mocked<GitHubAuthorizationService>
  return {
    service: {} as Mocked<AuthenticationService>,
    administration: {} as Mocked<AdministrationService>,
    prototypeAuthorization: {} as Mocked<PrototypeAuthorizationService>,
    githubAuthorization,
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

describe("GitHub authorization routes", () => {
  it("passes the authenticated session to repository listing without accepting a body token", async () => {
    const repository = { id: "repository-source" }
    const listRepositories = vi.fn().mockResolvedValue([repository])
    const authentication = runtime({ listRepositories })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration/github/repositories`, {
      headers: { cookie: `__Host-replica-session=${sessionToken}` },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ repositories: [repository] })
    expect(listRepositories).toHaveBeenCalledWith(sessionToken)
  })

  it("rejects repository mutations before the service when CSRF does not match", async () => {
    const linkRepository = vi.fn()
    const authentication = runtime({ linkRepository })
    const baseUrl = await serve(authentication)

    const response = await fetch(`${baseUrl}/api/administration/github/repositories`, {
      method: "POST",
      headers: { ...protectedHeaders, "x-csrf-token": "wrong-token" },
      body: JSON.stringify({ githubRepositoryId: "123" }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Request not allowed" })
    expect(linkRepository).not.toHaveBeenCalled()
  })

  it.each([
    ["accepted", 202],
    ["duplicate", 200],
    ["ignored", 200],
  ] as const)(
    "forwards the verified webhook envelope and returns %s as HTTP %i",
    async (result, status) => {
      const body = Buffer.from('{"installation":{"id":7}}')
      const processWebhook = vi.fn().mockResolvedValue(result)
      const authentication = runtime({ processWebhook })
      const baseUrl = await serve(authentication)

      const response = await fetch(`${baseUrl}/api/github/webhooks`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-1",
          "x-github-event": "installation",
          "x-hub-signature-256": "sha256=signature",
        },
        body,
      })

      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ result })
      expect(processWebhook).toHaveBeenCalledWith({
        deliveryId: "delivery-1",
        event: "installation",
        signature: "sha256=signature",
        body,
      })
    },
  )
})
