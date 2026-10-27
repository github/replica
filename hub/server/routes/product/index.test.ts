import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"
import type { Mocked } from "vitest"

import type { AdministrationService } from "#server/domains/administration/create-service/types"
import type { AuthenticationService } from "#server/domains/authentication/create-service/types"
import type { PrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service/types"
import { createLogger } from "#server/integrations/pino/create-logger"
import type { AuthenticationRoutes } from "#server/routes/types"
import { AuthenticationError } from "#server/utils/authentication-error"

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
  overrides: Partial<Mocked<PrototypeAuthorizationService>> = {},
): AuthenticationRoutes & {
  prototypeAuthorization: Mocked<PrototypeAuthorizationService>
} {
  const prototypeAuthorization = Object.assign(
    {
      listWorkspaces: vi.fn(),
      createWorkspace: vi.fn(),
      getWorkspace: vi.fn(),
      setWorkspaceAccess: vi.fn(),
      removeWorkspaceAccess: vi.fn(),
      listPrototypes: vi.fn(),
      createPrototype: vi.fn(),
      getPrototype: vi.fn(),
      archivePrototype: vi.fn(),
      createPublisherCredential: vi.fn(),
      setPublisherActive: vi.fn(),
      revokePublisherCredential: vi.fn(),
      explainPrototypeAccess: vi.fn(),
      setPrototypeAccess: vi.fn(),
      removePrototypeAccess: vi.fn(),
      listVersions: vi.fn(),
      getVersion: vi.fn(),
    },
    overrides,
  ) as Mocked<PrototypeAuthorizationService>
  return {
    service: {} as Mocked<AuthenticationService>,
    administration: {} as Mocked<AdministrationService>,
    prototypeAuthorization,
    settings: {
      origin: "https://hub.example",
      secureCookies: true,
      configured: true,
      admissionPolicy: "hub-managed",
      trustedProxyHops: 0,
    },
  }
}

async function serve(authentication: AuthenticationRoutes, logger = createLogger()) {
  const server = createServer(createApp({ authentication, logger }))
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

describe("product routes", () => {
  it.each([
    { method: "GET", path: "/api/workspaces", call: "listWorkspaces" },
    { method: "POST", path: "/api/workspaces", call: "createWorkspace", body: { name: "W" } },
    { method: "GET", path: "/api/workspaces/workspace", call: "getWorkspace" },
    {
      method: "PUT",
      path: "/api/workspaces/workspace/access/user",
      call: "setWorkspaceAccess",
      body: { effect: "allow", role: "viewer" },
    },
    {
      method: "DELETE",
      path: "/api/workspaces/workspace/access/user",
      call: "removeWorkspaceAccess",
    },
    {
      method: "GET",
      path: "/api/workspaces/workspace/prototypes",
      call: "listPrototypes",
    },
    {
      method: "POST",
      path: "/api/workspaces/workspace/prototypes",
      call: "createPrototype",
      body: { name: "P" },
    },
    { method: "GET", path: "/api/prototypes/prototype", call: "getPrototype" },
    {
      method: "POST",
      path: "/api/prototypes/prototype/publishers",
      call: "createPublisherCredential",
      body: { name: "Local publisher", actions: ["publish"] },
    },
    {
      method: "PATCH",
      path: "/api/prototypes/prototype/publishers/publisher",
      call: "setPublisherActive",
      body: { active: false },
    },
    {
      method: "DELETE",
      path: "/api/prototypes/prototype/publishers/publisher/credentials/credential",
      call: "revokePublisherCredential",
    },
    {
      method: "POST",
      path: "/api/prototypes/prototype/archive",
      call: "archivePrototype",
    },
    {
      method: "GET",
      path: "/api/prototypes/prototype/access/explanation",
      call: "explainPrototypeAccess",
    },
    {
      method: "PUT",
      path: "/api/prototypes/prototype/access/user",
      call: "setPrototypeAccess",
      body: { effect: "deny" },
    },
    {
      method: "DELETE",
      path: "/api/prototypes/prototype/access/user",
      call: "removePrototypeAccess",
    },
    {
      method: "GET",
      path: "/api/prototypes/prototype/versions",
      call: "listVersions",
    },
    {
      method: "GET",
      path: "/api/prototypes/prototype/versions/version",
      call: "getVersion",
    },
  ] as const)(
    "preserves authorization failures for $method $path",
    async ({ method, path, call, body }) => {
      const authentication = runtime({
        [call]: vi
          .fn()
          .mockRejectedValue(
            new AuthenticationError(403, "prototype_access_denied", "Prototype access is denied."),
          ),
      })
      const baseUrl = await serve(authentication)
      const mutation = method !== "GET"

      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: mutation ? protectedHeaders : { cookie: `__Host-replica-session=${sessionToken}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: "prototype_access_denied",
        message: "Prototype access is denied.",
      })
      expect(authentication.prototypeAuthorization[call].mock.calls).toHaveLength(1)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
    },
  )

  it.each([
    {
      name: "missing origin",
      headers: { ...protectedHeaders, origin: undefined },
    },
    {
      name: "wrong origin",
      headers: { ...protectedHeaders, origin: "https://attacker.example" },
    },
    {
      name: "wrong CSRF token",
      headers: { ...protectedHeaders, "x-csrf-token": "wrong-token" },
    },
  ])("rejects a mutation with $name before the product service runs", async ({ headers }) => {
    const authentication = runtime()
    const baseUrl = await serve(authentication)
    const requestHeaders = Object.fromEntries(
      Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined),
    )

    const response = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ name: "Private workspace name" }),
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "Request not allowed" })
    expect(authentication.prototypeAuthorization.createWorkspace.mock.calls).toHaveLength(0)
  })

  it("omits rejected product query and body values from request logs", async () => {
    const records: Record<string, unknown>[] = []
    const logger = createLogger({
      destination: {
        write: (line) => records.push(JSON.parse(line) as Record<string, unknown>),
      },
    })
    const authentication = runtime()
    const baseUrl = await serve(authentication, logger)

    const response = await fetch(`${baseUrl}/api/workspaces?note=private-query-value`, {
      method: "POST",
      headers: { ...protectedHeaders, origin: "https://attacker.example" },
      body: JSON.stringify({ note: "private-body-value" }),
    })

    expect(response.status).toBe(403)
    await vi.waitFor(() => expect(records).toHaveLength(1))
    expect(records[0]).not.toHaveProperty("query")
    expect(records[0]).not.toHaveProperty("body")
    expect(JSON.stringify(records)).not.toMatch(/private-query-value|private-body-value/)
  })

  it("allows 120 product mutations per boundary and rejects the next one", async () => {
    const authentication = runtime({
      createWorkspace: vi.fn().mockResolvedValue({ id: "workspace" }),
    })
    const baseUrl = await serve(
      authentication,
      createLogger({ destination: { write: () => undefined } }),
    )
    const responses = []

    for (let request = 0; request < 121; request++) {
      responses.push(
        await fetch(`${baseUrl}/api/workspaces`, {
          method: "POST",
          headers: protectedHeaders,
          body: JSON.stringify({ name: `Workspace ${request}` }),
        }),
      )
    }

    expect(responses.slice(0, 120).every(({ status }) => status === 201)).toBe(true)
    expect(responses[0]?.headers.get("cache-control")).toBe("private, no-store")
    expect(responses[120]?.status).toBe(429)
    expect(authentication.prototypeAuthorization.createWorkspace.mock.calls).toHaveLength(120)
  })
})
