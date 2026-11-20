import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../../../create-app"
import type { ArtifactStorage } from "../../../../domains/artifacts/create-artifact-storage/types"
import { createLogger } from "../../../../integrations/pino/create-logger"
import { prisma } from "../../../../integrations/prisma"
import { createAuthenticationRouteDependencies } from "../../../api/auth/create-authentication-route-dependencies"
import { createProductRouteDependencies } from "../../../api/product/create-product-route-dependencies"
import { createBuildPreviewRouteDependencies } from "../../create-build-preview-route-dependencies"

describe("private preview composition", () => {
  it("serves real product URLs without a wildcard setting and checks live sessions and grants for every resource", async () => {
    vi.stubEnv("HUB_PREVIEW_ORIGIN", undefined)
    const server = createServer()
    onTestFinished(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    )
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const { port } = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${port}`
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    const environment = {
      GITHUB_CLIENT_ID: "test-client",
      GITHUB_CLIENT_SECRET: "test-secret",
      GITHUB_PROVIDER_REVISION: "1",
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      ).toString("base64"),
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret-at-least-20-characters",
      HUB_APPLICATION_ORIGIN: origin,
      HUB_AUTHENTICATION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      HUB_BOOTSTRAP_SECRET: "test-bootstrap-secret-at-least-32-characters",
    }
    const authentication = await createAuthenticationRouteDependencies(environment)
    const provider = await prisma.authenticationProvider.findUniqueOrThrow({
      where: { key: "github" },
    })
    const user = await prisma.user.create({
      data: { profile: { create: { provider: "github", login: "preview-reader" } } },
    })
    const identity = await prisma.externalIdentity.create({
      data: {
        userId: user.id,
        provider: "github",
        issuer: "https://github.com",
        subject: user.id,
      },
    })
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        assignments: {
          create: {
            externalIdentityId: identity.id,
            providerRevisionId: provider.selectedRevisionId,
            providerAssignmentSubject: identity.subject,
            source: "AUTHENTICATION_PROVIDER",
            role: "MEMBER",
          },
        },
      },
    })
    const token = randomUUID()
    const session = await prisma.hubSession.create({
      data: {
        membershipId: membership.id,
        externalIdentityId: identity.id,
        providerRevisionId: provider.selectedRevisionId,
        digest: createHash("sha256").update(token).digest("hex"),
        revocationRevision: 0,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      },
    })
    const repository = await prisma.repository.create({
      data: { githubRepositoryId: 2001n, nameWithOwner: "team/previews", defaultBranch: "main" },
    })
    const retained = await prisma.repository.create({
      data: { githubRepositoryId: 2002n, nameWithOwner: "team/retained", defaultBranch: "main" },
    })
    await prisma.repositoryAccessGrant.createMany({
      data: [repository, retained].map(({ id }) => ({
        membershipId: membership.id,
        repositoryId: id,
        observedAt: new Date(),
      })),
    })
    const prototype = await prisma.prototype.create({
      data: {
        repositoryId: repository.id,
        branchName: "proto/checkout",
        startPage: "/checkout?stage=shipping#address",
      },
    })
    const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
    const packageFiles = new Map([
      [
        "dist/index.html",
        new TextEncoder().encode("<html><head></head><body>Saved checkout</body></html>"),
      ],
      ["dist/assets/app.css", new TextEncoder().encode("body { display: block }")],
      ["screenshots/desktop.png", png],
      ["screenshots/narrow.png", png],
    ])
    const bytesByKey = new Map<string, Uint8Array>()
    const build = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        commitSha: "a".repeat(40),
        githubWorkflowRunId: 3002n,
        artifacts: {
          create: Array.from(packageFiles, ([path, bytes]) => {
            const storageKey = randomUUID()
            bytesByKey.set(storageKey, bytes)
            return {
              path,
              kind: path.startsWith("screenshots/") ? "screenshot" : "dist",
              storageKey,
              byteLength: bytes.byteLength,
            }
          }),
        },
      },
    })
    await prisma.prototype.update({
      where: { id: prototype.id },
      data: { currentBuildId: build.id },
    })
    const read = vi.fn<ArtifactStorage["read"]>((key) => {
      const bytes = bytesByKey.get(key)
      return Promise.resolve(bytes ? { status: "ok", bytes } : { status: "not-found" })
    })
    const storage: ArtifactStorage = {
      isReady: vi.fn().mockResolvedValue(true),
      read,
      write: vi.fn(),
      delete: vi.fn(),
    }
    const preview = createBuildPreviewRouteDependencies(environment, storage)
    const product = createProductRouteDependencies({
      applicationOrigin: origin,
      scopeGitHubMembers: true,
    })
    server.on(
      "request",
      createApp({
        authentication,
        product,
        preview,
        logger: createLogger({ level: "silent" }),
      }),
    )
    const headers = { cookie: `hub_session=${token}`, accept: "text/html" }
    const detail = await fetch(
      `${origin}/api/repositories/${repository.id}/prototypes/${prototype.id}`,
      { headers },
    )
    expect(detail.status).toBe(200)
    const dto = (await detail.json()) as {
      selectedBuild: {
        previewUrl: string
        desktopScreenshotUrl: string
        narrowScreenshotUrl: string
      }
    }
    const mount = `${origin}/previews/github/2001/3002/`
    expect(dto.selectedBuild).toMatchObject({
      previewUrl: `${mount}checkout?stage=shipping#address`,
      desktopScreenshotUrl: `${mount}__replica/screenshots/desktop.png`,
      narrowScreenshotUrl: `${mount}__replica/screenshots/narrow.png`,
    })
    const document = await fetch(dto.selectedBuild.previewUrl, { headers })
    expect(document.status).toBe(200)
    expect(await document.text()).toContain("Saved checkout")
    for (const url of [
      dto.selectedBuild.desktopScreenshotUrl,
      dto.selectedBuild.narrowScreenshotUrl,
    ]) {
      const screenshot = await fetch(url, { headers })
      expect(screenshot.status).toBe(200)
      expect(screenshot.headers.get("content-type")).toBe("image/png")
      expect(new Uint8Array(await screenshot.arrayBuffer())).toEqual(png)
    }
    const resources = [
      dto.selectedBuild.previewUrl,
      dto.selectedBuild.desktopScreenshotUrl,
      dto.selectedBuild.narrowScreenshotUrl,
      `${mount}assets/app.css`,
      `${mount}__replica/bridge/v1.js`,
    ]
    for (const url of resources.slice(3)) {
      expect((await fetch(url, { headers })).status).toBe(200)
    }

    read.mockClear()
    await prisma.repositoryAccessGrant.deleteMany({
      where: { repositoryId: repository.id, membershipId: membership.id },
    })
    for (const url of resources) {
      expect((await fetch(url, { headers })).status, url).toBe(404)
    }
    await prisma.repositoryAccessGrant.create({
      data: {
        repositoryId: repository.id,
        membershipId: membership.id,
        observedAt: new Date(),
      },
    })
    expect(await authentication.signOut.end(session.digest)).toBe(true)
    for (const url of resources) {
      expect((await fetch(url, { headers })).status, url).toBe(401)
    }
    expect(read).not.toHaveBeenCalled()
  })
})
