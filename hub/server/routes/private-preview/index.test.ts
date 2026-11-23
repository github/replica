import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestListener,
} from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createApp } from "../../create-app"
import { createPrivatePreviewAuthority } from "../../domains/private-preview/create-authority"
import {
  privatePreviewManifestPath,
  readerExchangePath,
  type PrivatePreviewAuthority,
} from "../../domains/private-preview/types"
import { createLogger } from "../../integrations/pino/create-logger"
import { privatePreviewAddress } from "../../utils/private-preview-address"

const address = privatePreviewAddress("901", "1201")!
const hubOrigin = "https://hub.example.com"
const readerOrigin = "https://preview.example.net"

async function listen(app: RequestListener) {
  const server = createServer(app).listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo

  return function request(path: string, headers: Record<string, string> = {}, body?: string) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const outgoing = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path,
            method: body === undefined ? "GET" : "POST",
            headers: { host: new URL(hubOrigin).host, "x-forwarded-proto": "https", ...headers },
          },
          (response) => {
            response.setEncoding("utf8")
            let body = ""
            response.on("data", (chunk: string) => {
              body += chunk
            })
            response.on("error", reject)
            response.on("end", () =>
              resolve({ status: response.statusCode!, headers: response.headers, body }),
            )
          },
        )
        outgoing.on("error", reject)
        outgoing.end(body)
      },
    )
  }
}

async function startHub() {
  const readerSecret = randomBytes(32).toString("base64url")
  const grant = randomBytes(32).toString("base64url")
  const access = randomBytes(32).toString("base64url")
  const authority = {
    launch: vi.fn<PrivatePreviewAuthority["launch"]>().mockResolvedValue("allowed"),
    issue: vi.fn<PrivatePreviewAuthority["issue"]>().mockResolvedValue(grant),
    exchange: vi
      .fn<PrivatePreviewAuthority["exchange"]>()
      .mockResolvedValue({ access, startPage: "/" }),
    authorizeFile: vi.fn<PrivatePreviewAuthority["authorizeFile"]>(),
  }
  const request = await listen(
    createApp({
      logger: createLogger({ level: "silent" }),
      trustedProxyHops: 1,
      privatePreview: { settings: { hubOrigin, readerOrigin, readerSecret }, authority },
    }),
  )
  return { request, grant, access, readerSecret, authority }
}

function authorityFixture() {
  type Dependencies = Parameters<typeof createPrivatePreviewAuthority>[0]
  const viewer = {
    userId: randomUUID(),
    membershipId: randomUUID(),
    role: "MEMBER" as const,
    sessionProvider: "github",
  }
  const target = { buildId: randomUUID(), repositoryId: randomUUID(), startPage: "/" }
  const sessionDigest = randomBytes(32).toString("hex")
  const restoreSession = vi.fn<Dependencies["restoreSession"]>().mockResolvedValue(viewer)
  const isRepositoryVisible = vi.fn<Dependencies["isRepositoryVisible"]>().mockResolvedValue(true)
  const hasCurrentRepositoryAccess = vi
    .fn<Dependencies["hasCurrentRepositoryAccess"]>()
    .mockResolvedValue(true)
  const findTarget = vi.fn<Dependencies["findTarget"]>().mockResolvedValue(target)
  const read = vi.fn<Dependencies["access"]["read"]>()
  const issue = vi.fn<Dependencies["access"]["issue"]>()
  const exchange = vi.fn<Dependencies["access"]["exchange"]>()
  const findDistFile = vi.fn<Dependencies["findDistFile"]>()
  const readStorage = vi.fn<Dependencies["storage"]["read"]>()
  const authority = createPrivatePreviewAuthority({
    readerOrigin,
    restoreSession,
    isRepositoryVisible,
    hasCurrentRepositoryAccess,
    findTarget,
    access: { read, issue, exchange },
    findDistFile,
    storage: { read: readStorage },
  })
  return {
    authority,
    target,
    viewer,
    sessionDigest,
    restoreSession,
    isRepositoryVisible,
    hasCurrentRepositoryAccess,
    findDistFile,
    readStorage,
    read,
    issue,
    exchange,
  }
}

describe("private preview Hub routes", () => {
  it("does not expose the private launch or Reader exchange by default", async () => {
    const request = await listen(
      createApp({ logger: createLogger({ level: "silent" }), trustedProxyHops: 1 }),
    )

    const launch = await request(address.launch, { cookie: "hub_session=synthetic" })
    const exchange = await request(readerExchangePath, { "content-type": "application/json" }, "{}")

    expect(launch.status).toBe(404)
    expect(launch.headers.location).toBeUndefined()
    expect(exchange.status).toBe(404)
  })

  it("uses the Hub session and sends the grant in a POST form to the Reader", async () => {
    const { request, grant, authority } = await startHub()
    const session = randomBytes(32).toString("base64url")
    const sessionDigest = createHash("sha256").update(session).digest("hex")
    const challenge = randomBytes(32).toString("hex")
    const headers = { cookie: `hub_session=${session}` }

    const anonymous = await request(address.launch)
    expect(anonymous.status).toBe(401)
    expect(authority.launch).not.toHaveBeenCalled()

    const begin = await request(address.launch, headers)
    expect(begin.status).toBe(302)
    expect(begin.headers.location).toBe(`${readerOrigin}${address.begin}`)
    expect(authority.launch).toHaveBeenCalledWith(sessionDigest, address)

    const handoff = await request(`${address.launch}?challenge=${challenge}`, headers)
    expect(handoff.status).toBe(200)
    expect(handoff.headers.location).toBeUndefined()
    expect(handoff.headers["cache-control"]).toContain("no-store")
    const exchangeUrl = `${readerOrigin}${address.exchange}`
    expect(handoff.body).toContain(`<form method="post" action="${exchangeUrl}">`)
    expect(handoff.body).toContain(`name="grant" value="${grant}"`)
    expect(handoff.body).not.toContain(session)
    expect(authority.issue).toHaveBeenCalledWith(sessionDigest, address, challenge)
  })

  it("does not serve canonical preview files on the Hub origin", async () => {
    const { request, authority } = await startHub()

    const response = await request(`${address.mount}index.html`, {
      cookie: "hub_session=synthetic",
      accept: "text/html",
    })

    expect(response.status).toBe(404)
    expect(authority.authorizeFile).not.toHaveBeenCalled()
  })

  it("only lets the backend Reader credential reach the exchange authority", async () => {
    const { request, grant, access, readerSecret, authority } = await startHub()
    const challengeDigest = randomBytes(32).toString("hex")
    const body = JSON.stringify({
      repositoryId: address.repositoryId,
      runId: address.runId,
      grant,
      challengeDigest,
    })
    const headers = { "content-type": "application/json" }
    const authenticated = { ...headers, authorization: `Bearer ${readerSecret}` }

    const noCredential = await request(readerExchangePath, headers, body)
    const browser = await request(
      readerExchangePath,
      { ...authenticated, origin: readerOrigin },
      body,
    )
    expect(noCredential.status).toBe(404)
    expect(browser.status).toBe(404)
    expect(authority.exchange).not.toHaveBeenCalled()

    const backend = await request(readerExchangePath, authenticated, body)
    expect(backend.status).toBe(200)
    expect(JSON.parse(backend.body)).toEqual({ access, startPage: "/" })
    expect(authority.exchange).toHaveBeenCalledWith(grant, address, challengeDigest)
  })
})

describe("createPrivatePreviewAuthority()", () => {
  it("does not issue a handoff for a dist package built for a different mount", async () => {
    const { authority, target, sessionDigest, findDistFile, readStorage, issue } =
      authorityFixture()
    const bytes = Buffer.from(JSON.stringify({ basePath: "/previews/github/901/1202/" }))
    findDistFile.mockResolvedValue({
      storageKey: "synthetic-base-manifest",
      byteLength: bytes.length,
    })
    readStorage.mockResolvedValue({ status: "ok", bytes })

    await expect(authority.launch(sessionDigest, address)).resolves.toBe("incompatible")
    await expect(
      authority.issue(sessionDigest, address, randomBytes(32).toString("hex")),
    ).resolves.toBeNull()
    expect(findDistFile).toHaveBeenCalledWith(target.buildId, privatePreviewManifestPath)
    expect(issue).not.toHaveBeenCalled()
  })

  it("does not use a grant or access issued for a different immutable Build", async () => {
    const { authority, sessionDigest, read, exchange, findDistFile } = authorityFixture()
    const grantOrAccess = randomBytes(32).toString("base64url")
    const challengeDigest = randomBytes(32).toString("hex")
    const row = {
      buildId: randomUUID(),
      sessionDigest,
      readerOrigin,
      tokenDigest: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 30_000),
    }
    read
      .mockResolvedValueOnce({ ...row, challengeDigest })
      .mockResolvedValueOnce({ ...row, challengeDigest: null })

    await expect(authority.exchange(grantOrAccess, address, challengeDigest)).resolves.toBeNull()
    await expect(
      authority.authorizeFile(grantOrAccess, address, "dist/style.css", false),
    ).resolves.toBeNull()
    expect(exchange).not.toHaveBeenCalled()
    expect(findDistFile).not.toHaveBeenCalled()
  })

  it.each(["the Hub session", "repository permission"] as const)(
    "withholds file metadata when %s ends during lookup",
    async (revoked) => {
      const {
        authority,
        target,
        sessionDigest,
        restoreSession,
        isRepositoryVisible,
        findDistFile,
        read,
      } = authorityFixture()
      const access = randomBytes(32).toString("base64url")
      read.mockResolvedValue({
        buildId: target.buildId,
        sessionDigest,
        readerOrigin,
        tokenDigest: randomBytes(32).toString("hex"),
        challengeDigest: null,
        expiresAt: new Date(Date.now() + 30_000),
      })
      findDistFile.mockImplementation(() => {
        if (revoked === "the Hub session") restoreSession.mockResolvedValue(null)
        else isRepositoryVisible.mockResolvedValue(false)
        return Promise.resolve({ storageKey: "synthetic-style", byteLength: 20 })
      })

      const path = "dist/style.css"
      await expect(authority.authorizeFile(access, address, path, false)).resolves.toBeNull()
      expect(findDistFile).toHaveBeenCalledWith(target.buildId, path)
    },
  )

  it.each(["denies access", "is unavailable"] as const)(
    "does not authorize a file when the live repository check %s despite saved visibility",
    async (outcome) => {
      const {
        authority,
        target,
        viewer,
        sessionDigest,
        isRepositoryVisible,
        hasCurrentRepositoryAccess,
        findDistFile,
        read,
      } = authorityFixture()
      const access = randomBytes(32).toString("base64url")
      const path = "dist/style.css"
      const unavailable = new Error("Synthetic repository authority outage")
      read.mockResolvedValue({
        buildId: target.buildId,
        sessionDigest,
        readerOrigin,
        tokenDigest: randomBytes(32).toString("hex"),
        challengeDigest: null,
        expiresAt: new Date(Date.now() + 30_000),
      })
      findDistFile.mockResolvedValue({ storageKey: "synthetic-style", byteLength: 20 })
      if (outcome === "denies access") hasCurrentRepositoryAccess.mockResolvedValue(false)
      else hasCurrentRepositoryAccess.mockRejectedValue(unavailable)

      const result = authority.authorizeFile(access, address, path, false)

      if (outcome === "denies access") await expect(result).resolves.toBeNull()
      else await expect(result).rejects.toBe(unavailable)
      expect(isRepositoryVisible).toHaveBeenCalledWith(viewer, target.repositoryId)
      expect(hasCurrentRepositoryAccess).toHaveBeenCalledWith(viewer, target.repositoryId)
    },
  )
})
