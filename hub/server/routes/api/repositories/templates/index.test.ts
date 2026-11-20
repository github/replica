import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { describe, expect, it, vi } from "vitest"

import type { CurrentSessionDependencies } from "../../auth/types"
import { GitHubProviderRequestError } from "../../../../integrations/github/errors"
import type { WorkspaceProductRouteDependencies } from "../../product/types"
import { templateRoutes } from "."

type Viewer = NonNullable<Awaited<ReturnType<CurrentSessionDependencies["restore"]>>>

async function withTemplates(
  options: { provider: string; administrator?: boolean; permission?: "read" | "write" },
  run: (fixture: {
    read: (path: string, cookie?: string) => Promise<Response>
    visibility: ReturnType<typeof vi.fn<WorkspaceProductRouteDependencies["isRepositoryVisible"]>>
    restore: ReturnType<typeof vi.fn<CurrentSessionDependencies["restore"]>>
  }) => Promise<void>,
) {
  const repositoryId = randomUUID()
  const viewer: Viewer = {
    userId: randomUUID(),
    membershipId: randomUUID(),
    provider: options.provider,
    sessionProvider: options.provider,
    login: "member",
    name: null,
    role: options.administrator ? "ADMINISTRATOR" : "MEMBER",
  }
  const restore = vi.fn<CurrentSessionDependencies["restore"]>().mockResolvedValue(viewer)
  const visibility = vi
    .fn<WorkspaceProductRouteDependencies["isRepositoryVisible"]>()
    .mockResolvedValue(true)
  const product: WorkspaceProductRouteDependencies & {
    templates: NonNullable<WorkspaceProductRouteDependencies["templates"]>
  } = {
    isRepositoryVisible: visibility,
    getRepositoryPermission: vi.fn().mockResolvedValue(options.permission ?? "read"),
    templates: {
      findBuild: vi.fn().mockResolvedValue({
        repository: {
          id: repositoryId,
          nameWithOwner: "team/design",
          defaultBranch: "main",
          localPath: null,
        },
        build: null,
      }),
    },
    listRepositories: vi.fn(),
    findRepositoryIndex: vi.fn(),
    findRepositoryAuthors: vi.fn(),
    findPrototypeDetail: vi.fn(),
    readPrototypeWithIntroduction: vi.fn(),
    editPrototypeMetadata: vi.fn(),
    findBuildPreviewTarget: vi.fn(),
  }
  const routes = templateRoutes({ restore }, product, undefined)
  const app = express()
  app.get("/repositories/:repositoryId/templates", routes.catalog)
  app.get("/repositories/:repositoryId/templates/:templateId", routes.detail)
  app.get("/repositories/:repositoryId/create/permission", routes.permission)
  const server = createServer(app)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const { port } = server.address() as AddressInfo
    await run({
      visibility,
      restore,
      read: (path, cookie = "hub_session=member-session") =>
        fetch(`http://127.0.0.1:${port}/repositories/${repositoryId}${path}`, {
          headers: { cookie },
        }),
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

describe("templateRoutes()", () => {
  it.each([
    { access: "GitHub read-only", provider: "github", permission: "read" as const },
    { access: "Entra member", provider: "entra" },
    { access: "Hub administrator", provider: "github", administrator: true },
    { access: "GitHub writer", provider: "github", permission: "write" as const },
  ])("allows a visible $access to compose and start without repository writes", async (viewer) => {
    await withTemplates(viewer, async ({ read }) => {
      for (const path of ["/templates", "/templates/default", "/create/permission"]) {
        const response = await read(path)
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ canCreate: true })
      }
    })
  })

  it("denies an anonymous caller and a hidden repository even for an administrator", async () => {
    await withTemplates(
      { provider: "github", administrator: true },
      async ({ read, visibility }) => {
        visibility.mockResolvedValue(false)
        for (const path of ["/templates", "/templates/default", "/create/permission"]) {
          expect((await read(path, "")).status).toBe(401)
          expect((await read(path)).status).toBe(404)
        }
      },
    )
  })

  it("reports visibility provider failures instead of granting an administrator access", async () => {
    await withTemplates(
      { provider: "github", administrator: true },
      async ({ read, visibility }) => {
        visibility.mockRejectedValue(new GitHubProviderRequestError())
        for (const path of ["/templates", "/templates/default", "/create/permission"]) {
          const response = await read(path)
          expect(response.status).toBe(503)
          expect((await response.json()) as unknown).toHaveProperty("error")
        }
      },
    )
  })

  it("does not return kickoff permission after the session is revoked during the read", async () => {
    await withTemplates({ provider: "entra" }, async ({ read, restore }) => {
      const viewer = await restore("test-session")
      restore.mockReset().mockResolvedValueOnce(viewer).mockResolvedValueOnce(null)
      expect((await read("/create/permission")).status).toBe(401)
    })
  })
})
