import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../create-app"
import { revokeGitHubRepositoryAccess } from "../../../domains/admission/revoke-github-repository-access"
import { syncGitHubInstallationRepositories } from "../../../domains/admission/sync-github-installation-repositories"
import { hashAuthenticationValue } from "../../../domains/authentication/hash-authentication-value"
import { createPublicSharingService } from "../../../domains/public-sharing/create-public-sharing-service"
import { GitHubProviderRequestError } from "../../../integrations/github/errors"
import { prisma } from "../../../integrations/prisma"
import { createBuildPreviewRouteDependencies } from "../../build-preview/create-build-preview-route-dependencies"
import type { CurrentSessionDependencies } from "../auth/types"
import { createProductRouteDependencies } from "../product/create-product-route-dependencies"
import type { ProductRouteDependencies } from "../product/types"
import { createPublicSharingRouteDependencies } from "./create-public-sharing-route-dependencies"
import type { PublicSharingRouteDependencies } from "./types"

const environment = {
  HUB_APPLICATION_ORIGIN: "https://hub.example.com",
  HUB_PREVIEW_ORIGIN: "https://preview.example.net",
  HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
}
const enabledEnvironment = { ...environment, HUB_HOSTED_PUBLIC_SHARING_ENABLED: "true" }
const linkForm = { buildNumber: 1, expiration: "seven_days", label: "Preview for review" }

type Viewer = NonNullable<Awaited<ReturnType<CurrentSessionDependencies["restore"]>>>
type Permission = NonNullable<ProductRouteDependencies["getRepositoryPermission"]>

function signal() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => (resolve = complete))
  return { promise, resolve }
}

async function createActor(subject: string, role: Viewer["role"] = "MEMBER") {
  const user = await prisma.user.create({ data: {} })
  const externalIdentity = await prisma.externalIdentity.create({
    data: { issuer: "https://github.com", provider: "github", subject, userId: user.id },
  })
  const viewer: Viewer = {
    externalIdentityId: externalIdentity.id,
    login: "same-login",
    membershipId: randomUUID(),
    name: null,
    provider: "github",
    role,
    sessionProvider: "github",
    userId: user.id,
  }
  return viewer
}

async function createTarget(githubRepositoryId: number, subject: string) {
  const repository = await prisma.repository.create({
    data: { githubRepositoryId, defaultBranch: "main", nameWithOwner: "private/repository" },
  })
  const prototype = await prisma.prototype.create({
    data: { repositoryId: repository.id, branchName: "prototype/private-branch" },
  })
  const build = await createBuild(prototype.id, 1, subject)
  const path = `/api/repositories/${repository.id}/prototypes/${prototype.id}`
  return { repository, prototype, build, path, links: `${path}/share-links` }
}

function createBuild(prototypeId: string, number: number, subject: string, successful = true) {
  return prisma.build.create({
    data: {
      prototypeId,
      number,
      state: successful ? "successful" : "failed",
      authorProvider: "github",
      authorIssuer: "https://github.com",
      authorProviderUserId: subject,
      authorLogin: "same-login",
      ...(successful
        ? {
            artifacts: {
              create: [
                {
                  byteLength: 23,
                  storageKey: `${prototypeId}/${number}/dist`,
                  path: "dist/index.html",
                  kind: "dist",
                },
                {
                  byteLength: 10,
                  storageKey: `${prototypeId}/${number}/screenshot`,
                  path: "screenshots/desktop.png",
                  kind: "screenshot",
                },
              ],
            },
          }
        : {}),
    },
  })
}

async function startHub(
  sharing: PublicSharingRouteDependencies,
  viewers: Record<string, Viewer>,
  getRepositoryPermission: Permission,
) {
  const preview = createBuildPreviewRouteDependencies(environment, {
    isReady: () => Promise.resolve(true),
    read: (key) =>
      Promise.resolve(
        key.endsWith("/dist")
          ? { status: "ok", bytes: Buffer.from("<main>Saved Build</main>") }
          : key.endsWith("/screenshot")
            ? { status: "ok", bytes: Buffer.from("screenshot") }
            : { status: "not-found" },
      ),
    write: () => Promise.resolve({ status: "unavailable" }),
    delete: () => Promise.resolve({ status: "unavailable" }),
  })
  preview.readAvailableShareLink = sharing.readAvailableLink.bind(sharing)
  const sessions = new Map(
    Object.entries(viewers).map(([name, viewer]) => [hashAuthenticationValue(name), viewer]),
  )
  const product = {
    ...createProductRouteDependencies({
      applicationOrigin: preview.applicationOrigin,
      previewBaseOrigin: preview.previewBaseOrigin,
    }),
    getRepositoryPermission,
  }
  const server = createServer(
    createApp({
      logger: pino({ enabled: false }),
      authentication: {
        currentSession: { restore: (digest) => Promise.resolve(sessions.get(digest) ?? null) },
        signOut: { applicationOrigin: preview.applicationOrigin, secureCookie: true, end: vi.fn() },
      },
      preview,
      product,
      publicSharing: sharing,
    }),
  )
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as AddressInfo
  return {
    request(path: string, viewer?: string, method = "GET", body?: unknown) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
        headers: {
          ...(viewer ? { cookie: `hub_session=${viewer}`, origin: preview.applicationOrigin } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    },
    async preview(url: URL, cookie?: string) {
      return new Promise<{ status: number; cookie?: string; text: string }>((resolve, reject) => {
        const outgoing = request(
          {
            hostname: "127.0.0.1",
            port,
            path: url.pathname + url.search,
            headers: { host: url.host, ...(cookie ? { cookie } : {}) },
          },
          (response) => {
            let text = ""
            response.setEncoding("utf8")
            response.on("data", (chunk: string) => (text += chunk))
            response.on("end", () =>
              resolve({
                status: response.statusCode ?? 0,
                cookie: response.headers["set-cookie"]?.[0]?.split(";")[0],
                text,
              }),
            )
          },
        )
        outgoing.on("error", reject)
        outgoing.end()
      })
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

async function createLink(
  hub: Awaited<ReturnType<typeof startHub>>,
  path: string,
  viewer: string,
  buildNumber = 1,
) {
  const response = await hub.request(path, viewer, "POST", { ...linkForm, buildNumber })
  expect(response.status).toBe(201)
  const { link } = (await response.json()) as { link: { shareId: string; buildNumber: number } }
  return `/api/shared/${link.shareId}`
}

describe("hosted public sharing", () => {
  it("defaults off independently of a signed-in Hub administrator and rejects browser opt-in", async () => {
    const target = await createTarget(100, "51")
    const admin = await createActor("51", "ADMINISTRATOR")
    const lookup = vi.fn<Permission>().mockResolvedValue("admin")
    const sharing = await createPublicSharingService(prisma, environment, { mode: "hosted" })
    const hub = await startHub(sharing, { admin }, lookup)
    try {
      const settings = await hub.request("/api/product/sharing-settings", "admin", "PATCH", {
        operation: "enable",
        confirmed: true,
      })
      expect(settings.status).toBe(404)
      const create = await hub.request(target.links, "admin", "POST", linkForm)
      expect(create.status).toBe(403)
      expect(await create.json()).toMatchObject({ code: "public_sharing_disabled" })
      const prototype = await hub.request(`${target.path}?view=minimized`, "admin")
      expect(await prototype.json()).toMatchObject({ prototype: { canManageShareLinks: false } })
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      await hub.close()
    }
  })

  it("binds browser management to repository admin or a successful immutable author on that prototype", async () => {
    const target = await createTarget(100, "51")
    const other = await createTarget(200, "99")
    const selectedBuild = await createBuild(target.prototype.id, 2, "99")
    await createBuild(other.prototype.id, 2, "51", false)
    const author = await createActor("51")
    const hubAdmin = await createActor("52", "ADMINISTRATOR")
    const repoAdmin = await createActor("53")
    const entra = { ...author, sessionProvider: "entra", role: "ADMINISTRATOR" as const }
    const lookup = vi.fn<Permission>((viewer) =>
      Promise.resolve(
        viewer.externalIdentityId === repoAdmin.externalIdentityId
          ? "admin"
          : viewer.externalIdentityId === hubAdmin.externalIdentityId
            ? "write"
            : "read",
      ),
    )
    const sharing = await createPublicSharingService(prisma, enabledEnvironment, { mode: "hosted" })
    const hub = await startHub(sharing, { author, hubAdmin, repoAdmin, entra }, lookup)
    try {
      const prototype = await hub.request(`${target.path}?view=minimized&build=2`, "author")
      expect(await prototype.json()).toMatchObject({ prototype: { canManageShareLinks: true } })
      const failedAuthor = await hub.request(`${other.path}?view=minimized`, "author")
      expect(await failedAuthor.json()).toMatchObject({ prototype: { canManageShareLinks: false } })
      expect((await hub.request(target.links, "hubAdmin", "POST", linkForm)).status).toBe(403)
      expect((await hub.request(target.links, "entra", "POST", linkForm)).status).toBe(403)

      const publicPath = await createLink(hub, target.links, "author", 2)
      const shareId = publicPath.split("/").at(-1)!
      const saved = await prisma.shareLink.findUniqueOrThrow({ where: { publicId: shareId } })
      await createBuild(target.prototype.id, 3, "99")
      const metadata = await hub.request(publicPath)
      expect(await metadata.json()).toEqual({
        state: "active",
        prototypeName: "Shared prototype",
        label: linkForm.label,
        buildNumber: 2,
        previewUrl: `${environment.HUB_APPLICATION_ORIGIN}${publicPath}/preview`,
        expiresAt: saved.expiresAt.toISOString(),
        controlsIdentity: `share:${shareId}`,
        controlsOrigin: `https://${selectedBuild.id}.preview.example.net`,
      })
      expect((await hub.request(target.links, "hubAdmin")).status).toBe(403)
      expect((await hub.request(`${target.links}/${shareId}`, "hubAdmin", "DELETE")).status).toBe(
        403,
      )
      const list = await hub.request(target.links, "repoAdmin")
      expect(await list.json()).toMatchObject({ links: [{ shareId, buildNumber: 2 }] })
      expect((await hub.request(`${target.links}/${shareId}`, "repoAdmin", "DELETE")).status).toBe(
        200,
      )
      expect((await hub.request(publicPath)).status).toBe(404)
    } finally {
      await hub.close()
    }
  })

  it("does not mistake provider failure for loss and invalidates earlier positive proof after scoped loss", async () => {
    const target = await createTarget(100, "51")
    const other = await createTarget(200, "51")
    const author = await createActor("51")
    const repoAdmin = await createActor("52")
    const lookup = vi.fn<Permission>((viewer) =>
      Promise.resolve(
        viewer.externalIdentityId === repoAdmin.externalIdentityId ? "admin" : "read",
      ),
    )
    const sharing = await createPublicSharingService(prisma, enabledEnvironment, { mode: "hosted" })
    const hub = await startHub(sharing, { author, repoAdmin }, lookup)
    const release = signal()
    try {
      const lost = await createLink(hub, target.links, "author")
      const otherRepository = await createLink(hub, other.links, "author")
      const otherCreator = await createLink(hub, target.links, "repoAdmin")

      lookup.mockRejectedValueOnce(new GitHubProviderRequestError())
      expect((await hub.request(target.links, "author")).status).toBe(503)
      lookup.mockClear()
      expect((await hub.request(lost)).status).toBe(200)
      expect(lookup).not.toHaveBeenCalled()

      const started = signal()
      lookup.mockImplementationOnce(async () => {
        started.resolve()
        await release.promise
        return "read"
      })
      const pending = hub.request(target.links, "author", "POST", linkForm)
      await started.promise
      lookup.mockResolvedValueOnce("none")
      expect((await hub.request(target.links, "author")).status).toBe(404)
      release.resolve()
      expect((await pending).status).toBe(409)
      expect((await hub.request(lost)).status).toBe(404)
      expect((await hub.request(otherRepository)).status).toBe(200)
      expect((await hub.request(otherCreator)).status).toBe(200)
      expect((await hub.request(await createLink(hub, target.links, "author"))).status).toBe(200)
      expect((await hub.request(lost)).status).toBe(404)
    } finally {
      release.resolve()
      await hub.close()
    }
  })

  it("serves only the pinned Build over public handoffs and blocks them permanently after policy disablement", async () => {
    const target = await createTarget(100, "51")
    const author = await createActor("51")
    const lookup = vi.fn<Permission>().mockResolvedValue("read")
    const sharing = await createPublicSharingService(prisma, enabledEnvironment, { mode: "hosted" })
    const hub = await startHub(sharing, { author }, lookup)
    try {
      const path = await createLink(hub, target.links, "author")
      const redirect = await hub.request(`${path}/preview`)
      const handoff = new URL(redirect.headers.get("location")!)
      expect(handoff.hostname).toBe(`${target.build.id}.preview.example.net`)
      const authorized = await hub.preview(handoff)
      expect(authorized.status).toBe(303)
      expect(authorized.cookie).toMatch(/^replica_share_preview=/)
      const previewUrl = new URL("/", handoff)
      const saved = await hub.preview(previewUrl, authorized.cookie)
      expect(saved.status).toBe(200)
      expect(saved.text).toContain("Saved Build")
      const screenshot = new URL("/__replica/screenshots/desktop.png", handoff)
      expect((await hub.preview(screenshot, authorized.cookie)).status).toBe(404)

      const disabled = await createPublicSharingService(prisma, environment, { mode: "hosted" })
      expect((await disabled.getSettings()).enabled).toBe(false)
      expect((await hub.request(path)).status).toBe(404)
      expect((await hub.preview(handoff)).status).toBe(404)
      expect((await hub.preview(previewUrl, authorized.cookie)).status).toBe(404)
      await createPublicSharingService(prisma, enabledEnvironment, { mode: "hosted" })
      expect((await hub.request(path)).status).toBe(404)
      expect((await hub.preview(previewUrl, authorized.cookie)).status).toBe(404)
    } finally {
      await hub.close()
    }
  })

  it("permanently revokes links on a confirmed installation disconnection, not an ambiguous access event", async () => {
    const target = await createTarget(100, "51")
    const author = await createActor("51")
    const provider = { configurationDigest: "a".repeat(64), revision: 1 }
    const auth = await prisma.authenticationProvider.create({
      data: { key: "github", enabled: false },
    })
    const revision = await prisma.authenticationProviderRevision.create({
      data: { providerId: auth.id, ...provider },
    })
    await prisma.authenticationProvider.update({
      where: { id: auth.id },
      data: { enabled: true, selectedRevisionId: revision.id },
    })
    const sharing = await createPublicSharingRouteDependencies(enabledEnvironment, {
      hostedReady: true,
    })
    expect(sharing).toBeDefined()
    const hub = await startHub(sharing!, { author }, vi.fn<Permission>().mockResolvedValue("read"))
    try {
      const path = await createLink(hub, target.links, "author")
      await revokeGitHubRepositoryAccess(
        prisma,
        { disconnect: false, githubRepositoryIds: "all" },
        provider,
      )
      expect((await hub.request(path)).status).toBe(200)
      await revokeGitHubRepositoryAccess(
        prisma,
        { disconnect: true, githubRepositoryIds: [100] },
        provider,
      )
      expect((await hub.request(path)).status).toBe(404)
      await syncGitHubInstallationRepositories(
        prisma,
        () =>
          Promise.resolve([
            {
              githubRepositoryId: 100,
              defaultBranch: "main",
              nameWithOwner: "private/repository",
            },
          ]),
        provider,
      )
      expect((await hub.request(await createLink(hub, target.links, "author"))).status).toBe(200)
      expect((await hub.request(path)).status).toBe(404)
    } finally {
      await hub.close()
    }
  })
})
