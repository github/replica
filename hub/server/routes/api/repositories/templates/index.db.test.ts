import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request } from "node:http"
import type { IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { expect, it, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { hubSessionCookieName } from "../../../../integrations/express/hub-session-cookie-name"
import { prisma } from "../../../../integrations/prisma"
import { findBuildArtifact } from "../../../../repositories/build-artifacts/find-build-artifact"
import { findBuildPreviewTarget } from "../../../../repositories/build-artifacts/find-build-preview-target"
import { createProductRouteDependencies } from "../../product/create-product-route-dependencies"
import type { WorkspaceProductRouteDependencies } from "../../product/types"

async function withRepository(
  run: (fixture: {
    repositoryId: string
    files: Map<string, Uint8Array>
    read: (path?: string) => Promise<Response>
    readPreview: (
      url: URL,
      cookie?: string,
    ) => Promise<{
      status: number | undefined
      headers: IncomingHttpHeaders
      bytes: Buffer
    }>
    permission: ReturnType<
      typeof vi.fn<NonNullable<WorkspaceProductRouteDependencies["getRepositoryPermission"]>>
    >
  }) => Promise<void>,
  provider: "github" | "entra" = "github",
) {
  const { id: repositoryId } = await prisma.repository.create({
    data: { nameWithOwner: "example/templates", defaultBranch: "main", githubRepositoryId: 456 },
  })
  const { id: userId } = await prisma.user.create({ data: {} })
  const { id: membershipId } = await prisma.membership.create({ data: { userId } })
  await prisma.repositoryAccessGrant.create({
    data: { repositoryId, membershipId, observedAt: new Date() },
  })
  const origin = "http://localhost:5173"
  const files = new Map<string, Uint8Array>()
  const permission = vi
    .fn<NonNullable<WorkspaceProductRouteDependencies["getRepositoryPermission"]>>()
    .mockResolvedValue("read")
  function restore() {
    return Promise.resolve({
      userId,
      membershipId,
      provider,
      sessionProvider: provider,
      login: "template-viewer",
      name: null,
      role: "MEMBER" as const,
    })
  }
  const server = createServer(
    createApp({
      authentication: {
        currentSession: { restore },
        signOut: { applicationOrigin: origin, secureCookie: false, end: vi.fn() },
      },
      product: createProductRouteDependencies({
        scopeGitHubMembers: true,
        getRepositoryPermission: permission,
      }),
      preview: {
        applicationOrigin: origin,
        previewBaseOrigin: "http://preview.localhost:3001",
        encryptionKey: randomBytes(32),
        bridgeSource: "",
        restoreSession: restore,
        findTargetById: (buildId, target) => findBuildPreviewTarget(prisma, { buildId, target }),
        findArtifact: (buildId, path) => findBuildArtifact(prisma, buildId, path),
        storage: {
          isReady: () => Promise.resolve(true),
          read: (key) => {
            const bytes = files.get(key)
            return Promise.resolve(bytes ? { status: "ok", bytes } : { status: "not-found" })
          },
          write: vi.fn(),
          delete: vi.fn(),
        },
      },
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  try {
    await run({
      repositoryId,
      files,
      permission,
      read: (path = "/templates") =>
        fetch(`http://127.0.0.1:${port}/api/repositories/${repositoryId}${path}`, {
          headers: { Cookie: `${hubSessionCookieName}=template-test` },
          redirect: "manual",
        }),
      readPreview: (url, cookie = "") =>
        new Promise((resolve, reject) => {
          const outgoing = request(
            {
              hostname: "127.0.0.1",
              port,
              path: `${url.pathname}${url.search}`,
              headers: { Host: url.host, Cookie: cookie, Accept: "text/html" },
            },
            (response) => {
              const chunks: Buffer[] = []
              response.on("data", (chunk: Buffer) => chunks.push(chunk))
              response.on("end", () =>
                resolve({
                  status: response.statusCode,
                  headers: response.headers,
                  bytes: Buffer.concat(chunks),
                }),
              )
              response.on("error", reject)
            },
          )
          outgoing.on("error", reject)
          outgoing.end()
        }),
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

it("keeps the catalog, screenshot, and routed preview on one successful default-branch snapshot", async () => {
  await withRepository(async ({ repositoryId, read, readPreview, files }) => {
    const { id: prototypeId } = await prisma.prototype.create({
      data: { repositoryId, branchName: "main", replica: true },
    })
    const route = "/settings.v2?panel=1#heading"
    const manifest = Buffer.from(
      JSON.stringify({
        version: 1,
        templates: [
          {
            id: "settings",
            name: "Settings",
            category: "Administration",
            description: "Edit user preferences.",
            path: route,
          },
        ],
      }),
    )
    const manifestKey = randomUUID()
    const previewKey = randomUUID()
    const screenshotKey = randomUUID()
    const html = Buffer.from("<html><body>Saved Settings</body></html>")
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    files.set(manifestKey, manifest)
    files.set(previewKey, html)
    files.set(screenshotKey, png)
    const selected = await prisma.build.create({
      data: {
        prototypeId,
        number: 2,
        state: "successful",
        workflowCreatedAt: new Date("2026-01-03"),
        artifacts: {
          create: [
            {
              path: "templates.json",
              kind: "manifest",
              storageKey: manifestKey,
              byteLength: manifest.byteLength,
            },
            {
              path: "dist/index.html",
              kind: "dist",
              storageKey: previewKey,
              byteLength: html.byteLength,
            },
            {
              path: "screenshots/templates/settings/desktop.png",
              kind: "screenshot",
              storageKey: screenshotKey,
              byteLength: png.byteLength,
            },
          ],
        },
      },
    })
    await prisma.build.createMany({
      data: [
        { prototypeId, number: 3, state: "successful", workflowCreatedAt: new Date("2026-01-01") },
        { prototypeId, number: 4, state: "failed", workflowCreatedAt: new Date("2026-01-04") },
      ],
    })
    const list = await read()
    expect(list.status).toBe(200)
    const catalog = (await list.json()) as {
      templates: { id: string; screenshotUrl: string }[]
    }
    expect(catalog).toMatchObject({ canCreate: true, submissionMode: "copilot" })
    const { templates } = catalog
    expect(templates.map(({ id }) => id)).toEqual(["default", "settings"])
    expect(templates[1]).toMatchObject({ buildNumber: 2, category: "Administration", route })
    const screenshot = new URL(templates[1]!.screenshotUrl)
    expect(screenshot.pathname).toContain(`/template-builds/${selected.id}/access`)
    const detail = await read("/templates/settings")
    expect(detail.status).toBe(200)
    const saved = (await detail.json()) as {
      template: { previewUrl: string }
      initialRoute: string
    }
    expect(saved).toMatchObject({ canCreate: true, submissionMode: "copilot" })
    const { template, initialRoute } = saved
    const preview = new URL(template.previewUrl)
    expect(preview.pathname).toBe(screenshot.pathname)
    expect(preview.searchParams.get("route")).toBe(initialRoute)
    expect(initialRoute).toBe(route)

    const accessPath = preview.pathname.slice(`/api/repositories/${repositoryId}`.length)
    const granted = await read(accessPath + preview.search)
    expect(granted.status).toBe(302)
    const authorize = new URL(granted.headers.get("location")!)
    expect(authorize.origin).toBe(`http://${selected.id}.preview.localhost:3001`)
    const exchanged = await readPreview(authorize)
    expect(exchanged.status).toBe(303)
    expect(exchanged.headers.location).toBe(route)
    const cookie = exchanged.headers["set-cookie"]?.[0]?.split(";", 1)[0]
    expect(cookie).toBeDefined()
    const frame = await readPreview(new URL(route, authorize), cookie)
    expect(frame.bytes.toString()).toContain("Saved Settings")
    const previewScreenshot = new URL(
      "/__replica/screenshots/templates/settings/desktop.png",
      authorize,
    )
    expect((await readPreview(previewScreenshot)).status).toBe(404)
    const captured = await readPreview(previewScreenshot, cookie)
    expect(captured.headers["content-type"]).toBe("image/png")
    expect(captured.bytes).toEqual(png)

    files.delete(manifestKey)
    expect((await read()).status).toBe(503)
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { defaultBranch: "trunk" },
    })
    const renamed = await read()
    expect(await renamed.json()).toMatchObject({ templates: [{ id: "default", previewUrl: null }] })
    expect((await read(accessPath + screenshot.search)).status).toBe(404)
  })
})

it("offers a visible reader a hosted handoff without granting listing management", async () => {
  await withRepository(async ({ read, permission }) => {
    expect(await (await read("/templates/default")).json()).toMatchObject({
      canCreate: true,
      submissionMode: "copilot",
      template: { id: "default" },
    })
    expect(await (await read("/create/permission")).json()).toEqual({ canCreate: true })
    const management = await read("/prototype-management")
    expect(management.status).toBe(404)
    permission.mockResolvedValue("write")
    expect((await read("/prototype-management")).status).toBe(200)
    expect(await (await read()).json()).toMatchObject({
      canCreate: true,
      submissionMode: "copilot",
    })
    expect(await (await read("/create/permission")).json()).toEqual({ canCreate: true })
  })
})

it("allows a visible viewer to start a handoff without checking GitHub permission", async () => {
  await withRepository(async ({ read, permission }) => {
    permission.mockRejectedValue(new Error("GitHub unavailable"))

    for (const path of ["/templates", "/templates/default"]) {
      const response = await read(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        canCreate: true,
        submissionMode: "copilot",
      })
    }
    const handoff = await read("/create/permission")
    expect(handoff.status).toBe(200)
    expect(await handoff.json()).toEqual({ canCreate: true })
    expect(permission).not.toHaveBeenCalled()
  })
})

it("lets an Entra viewer start a Copilot handoff from the blank template", async () => {
  await withRepository(async ({ read }) => {
    for (const path of ["/templates", "/templates/default"]) {
      const response = await read(path)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        canCreate: true,
        submissionMode: "copilot",
      })
    }
    expect(await (await read("/templates/default")).json()).toMatchObject({
      template: { id: "default" },
    })
    expect(await (await read("/create/permission")).json()).toEqual({ canCreate: true })
  }, "entra")
})

it("conceals the composer and Copilot handoff from a viewer outside repository scope", async () => {
  await withRepository(async ({ repositoryId, read, permission }) => {
    await prisma.repositoryAccessGrant.deleteMany({ where: { repositoryId } })
    permission.mockResolvedValue("write")
    expect((await read()).status).toBe(404)
    expect((await read("/templates/default")).status).toBe(404)
    const denied = await read("/create/permission")
    expect(denied.status).toBe(404)
    expect(await denied.json()).not.toHaveProperty("canCopy")
  })
})
