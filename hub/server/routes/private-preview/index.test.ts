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
import { createPreviewSession } from "../../domains/build-preview/create-preview-session"
import { createPrivatePreviewAuthority } from "../../domains/private-preview/create-authority"
import { createLaunchProof } from "../../domains/private-preview/create-launch-proof"
import {
  privatePreviewManifestPath,
  readerAuthorizePath,
  readerExchangePath,
  type PrivatePreviewAuthority,
} from "../../domains/private-preview/types"
import { createSharePreviewSession } from "../../domains/public-sharing/create-share-preview-session"
import { createLogger } from "../../integrations/pino/create-logger"
import { privatePreviewAddress } from "../../utils/private-preview-address"
import type { BuildPreviewRouteDependencies } from "../build-preview/types"

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

async function startHub(preview?: BuildPreviewRouteDependencies) {
  const readerSecret = randomBytes(32).toString("base64url")
  const grant = randomBytes(32).toString("base64url")
  const access = randomBytes(32).toString("base64url")
  const buildId = randomUUID()
  const deadline = new Date(Date.now() + 30_000)
  const authority = {
    launchDeadline: vi.fn<PrivatePreviewAuthority["launchDeadline"]>().mockResolvedValue(deadline),
    launch: vi.fn<PrivatePreviewAuthority["launch"]>().mockResolvedValue("allowed"),
    issue: vi.fn<PrivatePreviewAuthority["issue"]>().mockResolvedValue(grant),
    exchange: vi
      .fn<PrivatePreviewAuthority["exchange"]>()
      .mockResolvedValue({ access, startPage: "/", buildId }),
    authorizeFile: vi.fn<PrivatePreviewAuthority["authorizeFile"]>(),
  }
  const hasCurrentHubSession = vi.fn<(digest: string) => Promise<boolean>>().mockResolvedValue(true)
  const settings = { hubOrigin, readerOrigin, readerSecret }
  const request = await listen(
    createApp({
      logger: createLogger({ level: "silent" }),
      trustedProxyHops: 1,
      preview,
      privatePreview: { settings, authority, hasCurrentHubSession },
    }),
  )
  return {
    request,
    grant,
    access,
    buildId,
    deadline,
    readerSecret,
    authority,
    hasCurrentHubSession,
    proof: createLaunchProof(settings),
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function form(fields: Record<string, string>) {
  return new URLSearchParams(fields).toString()
}

function postHeaders(origin: string, session?: string) {
  return {
    origin,
    "content-type": "application/x-www-form-urlencoded",
    ...(session ? { cookie: `__Host-hub_session=${session}` } : {}),
  }
}

function readAutoForm(
  response: { status: number; headers: IncomingHttpHeaders; body: string },
  action: string,
  field: string,
) {
  expect(response.status).toBe(200)
  expect(response.headers.location).toBeUndefined()
  expect(response.headers["cache-control"]).toContain("no-store")
  expect(response.headers["referrer-policy"]).toBe("origin")
  expect(response.body).toContain(`<form method="post" action="${action}">`)
  expect(response.body).not.toMatch(/<button\b/)
  const nonce = response.body.match(/<script nonce="([^"]+)">[^<]*\.submit\(\)/)?.[1]
  expect(nonce).toBeTruthy()
  expect(response.headers["content-security-policy"]).toContain(`script-src 'nonce-${nonce}'`)
  const value = response.body.match(new RegExp(`name="${field}" value="([^"]+)"`))?.[1]
  expect(value).toBeTruthy()
  return value!
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
  const clock = vi
    .fn<Dependencies["access"]["clock"]>()
    .mockImplementation(() => Promise.resolve(new Date()))
  const findDistFile = vi.fn<Dependencies["findDistFile"]>()
  const readStorage = vi.fn<Dependencies["storage"]["read"]>()
  const authority = createPrivatePreviewAuthority({
    readerOrigin,
    restoreSession,
    isRepositoryVisible,
    hasCurrentRepositoryAccess,
    findTarget,
    access: { clock, read, issue, exchange },
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

    const launch = await request(
      address.launch,
      postHeaders(hubOrigin, randomBytes(32).toString("base64url")),
      form({ start: "one-click", buildId: randomUUID() }),
    )
    const exchange = await request(readerExchangePath, { "content-type": "application/json" }, "{}")

    expect(launch.status).toBe(404)
    expect(launch.headers.location).toBeUndefined()
    expect(exchange.status).toBe(404)
  })

  it("opens the selected Build in one click by sending a signed intent to the Reader", async () => {
    const { request, authority, buildId, deadline, proof } = await startHub()
    const session = randomBytes(32).toString("base64url")

    const launch = await request(
      address.launch,
      postHeaders(hubOrigin, session),
      form({ start: "one-click", buildId }),
    )

    const intent = readAutoForm(launch, `${readerOrigin}${address.begin}`, "intent")
    expect(launch.body).not.toContain(session)
    expect(authority.launch).toHaveBeenCalledExactlyOnceWith(digest(session), address, buildId)
    expect(authority.issue).not.toHaveBeenCalled()
    const challenge = randomBytes(32).toString("hex")
    const continuation = proof.attest(intent, address, () => challenge)!
    expect(proof.read(continuation, address, digest(session))).toMatchObject({
      buildId,
      expiresAt: deadline,
      challenge,
    })
    expect(proof.read(continuation, address, digest("another session"))).toBeNull()
  })

  it("no longer serves a confirmation page for the raw launch URL", async () => {
    const { request, authority } = await startHub()
    const cookie = `__Host-hub_session=${randomBytes(32).toString("base64url")}`

    const launch = await request(`${address.launch}?challenge=${"a".repeat(64)}`, { cookie })

    expect(launch.status).toBe(404)
    expect(launch.body).not.toContain("<form")
    expect(authority.launch).not.toHaveBeenCalled()
  })

  it.each([
    { reason: "no Hub session", cookie: undefined },
    { reason: "only a legacy session", cookie: "hub_session" },
  ])("asks a one-click launch with $reason to sign in again", async ({ cookie }) => {
    const { request, authority, buildId } = await startHub()
    const headers: Record<string, string> = postHeaders(hubOrigin)
    if (cookie) headers.cookie = `${cookie}=${randomBytes(32).toString("base64url")}`

    const launch = await request(address.launch, headers, form({ start: "one-click", buildId }))

    expect(launch.status).toBe(401)
    expect(launch.body).toContain("Sign in to Hub")
    expect(authority.launch).not.toHaveBeenCalled()
  })

  it.each([
    { status: "denied", expected: 404 },
    { status: "incompatible", expected: 409 },
  ] as const)("does not start a launch Hub $status", async ({ status, expected }) => {
    const { request, authority, buildId } = await startHub()
    authority.launch.mockResolvedValue(status)

    const launch = await request(
      address.launch,
      postHeaders(hubOrigin, randomBytes(32).toString("base64url")),
      form({ start: "one-click", buildId }),
    )

    expect(launch.status).toBe(expected)
    expect(launch.body).not.toContain("<form")
  })

  it.each([
    { reason: "a different origin on the same site", origin: "https://other.example.com" },
    { reason: "the Reader origin", origin: readerOrigin },
    { reason: "no origin", origin: undefined },
  ])("rejects a launch POST from $reason", async ({ origin }) => {
    const { request, authority, buildId } = await startHub()
    const headers: Record<string, string> = postHeaders(
      hubOrigin,
      randomBytes(32).toString("base64url"),
    )
    if (origin) headers.origin = origin
    else delete headers.origin

    const launch = await request(address.launch, headers, form({ start: "one-click", buildId }))

    expect(launch.status).toBe(404)
    expect(authority.launch).not.toHaveBeenCalled()
    expect(authority.issue).not.toHaveBeenCalled()
  })

  it("relays a Reader return to Hub without issuing access, then issues one bound handoff", async () => {
    const { request, grant, authority, buildId, deadline, proof } = await startHub()
    const session = randomBytes(32).toString("base64url")
    const challenge = randomBytes(32).toString("hex")
    const intent = proof.start(address, buildId, digest(session), deadline)
    const continuation = proof.attest(intent, address, () => challenge)!

    const relay = await request(
      address.launchReturn,
      { ...postHeaders(readerOrigin), cookie: `__Host-hub_session=${session}` },
      form({ continuation }),
    )

    expect(readAutoForm(relay, `${hubOrigin}${address.launch}`, "continuation")).toBe(continuation)
    expect(authority.issue).not.toHaveBeenCalled()

    const handoff = await request(
      address.launch,
      postHeaders(hubOrigin, session),
      form({ continuation }),
    )

    const ticket = readAutoForm(handoff, `${readerOrigin}${address.exchange}`, "grant")
    const { id } = proof.read(continuation, address)!
    expect(ticket).toBe(`${id}.${grant}`)
    expect(authority.issue).toHaveBeenCalledExactlyOnceWith(digest(session), address, challenge, {
      id,
      buildId,
      expiresAt: deadline,
    })

    const otherSession = await request(
      address.launch,
      postHeaders(hubOrigin, randomBytes(32).toString("base64url")),
      form({ continuation }),
    )
    expect(otherSession.status).toBe(404)
    expect(authority.issue).toHaveBeenCalledOnce()
  })

  it.each([
    { reason: "from Hub itself", origin: hubOrigin, tamper: false },
    { reason: "with a forged proof", origin: readerOrigin, tamper: true },
  ])("does not relay a Reader return $reason", async ({ origin, tamper }) => {
    const { request, buildId, deadline, proof } = await startHub()
    const intent = proof.start(address, buildId, digest("session"), deadline)
    const continuation = proof.attest(intent, address, () => "b".repeat(64))!
    const value = tamper
      ? `${continuation.slice(0, -1)}${continuation.endsWith("A") ? "B" : "A"}`
      : continuation

    const relay = await request(
      address.launchReturn,
      postHeaders(origin),
      form({ continuation: value }),
    )

    expect(relay.status).toBe(404)
    expect(relay.body).not.toContain("<form")
  })

  it("renews an ended Reader session through Hub for the exact Build and destination", async () => {
    const { request, grant, authority, buildId, deadline, proof } = await startHub()
    const session = randomBytes(32).toString("base64url")
    const challenge = randomBytes(32).toString("hex")
    // A Reader clock behind the database must not make renewal fail.
    vi.spyOn(Date, "now").mockReturnValueOnce(Date.now() - 5 * 60_000)
    const state = proof.startResume(address, buildId, challenge, "/checkout/?step=2")!

    const relay = await request(
      address.launchReturn,
      postHeaders(readerOrigin),
      form({ resume: state.token }),
    )
    expect(readAutoForm(relay, `${hubOrigin}${address.launch}`, "resume")).toBe(state.token)
    expect(authority.issue).not.toHaveBeenCalled()

    const handoff = await request(
      address.launch,
      postHeaders(hubOrigin, session),
      form({ resume: state.token }),
    )

    expect(readAutoForm(handoff, `${readerOrigin}${address.exchange}`, "grant")).toBe(
      `${state.id}.${grant}`,
    )
    expect(authority.issue).toHaveBeenCalledExactlyOnceWith(digest(session), address, challenge, {
      id: state.id,
      buildId,
      expiresAt: deadline,
    })
  })

  it.each([
    { reason: "without a Hub session", session: false, current: true, expected: 303 },
    { reason: "after the Hub session ended", session: true, current: false, expected: 303 },
    { reason: "when access is denied", session: true, current: true, expected: 404 },
  ])("does not renew $reason", async ({ session, current, expected }) => {
    const { request, authority, buildId, proof, hasCurrentHubSession } = await startHub()
    authority.issue.mockResolvedValue(null)
    hasCurrentHubSession.mockResolvedValue(current)
    const state = proof.startResume(address, buildId, "c".repeat(64), "/")!

    const response = await request(
      address.launch,
      postHeaders(hubOrigin, session ? randomBytes(32).toString("base64url") : undefined),
      form({ resume: state.token }),
    )

    expect(response.status).toBe(expected)
    expect(response.headers.location).toBe(expected === 303 ? "/" : undefined)
    expect(response.body).not.toContain("<form")
  })

  it("does not serve canonical preview files on the Hub origin", async () => {
    const { request, authority } = await startHub()

    const response = await request(`${address.mount}index.html`, {
      cookie: `__Host-hub_session=${randomBytes(32).toString("base64url")}`,
      accept: "text/html",
    })

    expect(response.status).toBe(404)
    expect(authority.authorizeFile).not.toHaveBeenCalled()
  })

  it("preserves legacy and hosted-public Build assets under the Hub-only route prefix", async () => {
    const buildId = randomUUID()
    const encryptionKey = randomBytes(32)
    const expiresAt = new Date(Date.now() + 60_000)
    const previewBaseOrigin = "https://builds.example.com"
    const path = "/api/private-preview/style.css"
    const bytes = Buffer.from("body { color: black; }")
    const findArtifact = vi.fn<BuildPreviewRouteDependencies["findArtifact"]>((id, artifactPath) =>
      Promise.resolve(
        id === buildId && artifactPath === `dist${path}`
          ? { storageKey: "synthetic-style", byteLength: bytes.length }
          : null,
      ),
    )
    const { request, authority } = await startHub({
      applicationOrigin: hubOrigin,
      previewBaseOrigin,
      encryptionKey,
      bridgeSource: "",
      storage: {
        isReady: vi.fn(),
        read: vi.fn().mockResolvedValue({ status: "ok", bytes }),
        write: vi.fn(),
        delete: vi.fn(),
      },
      findTargetById: vi
        .fn()
        .mockResolvedValue({ buildId, startPage: "/", artifactPath: "dist/index.html" }),
      findArtifact,
      restoreSession: vi.fn().mockResolvedValue({ userId: randomUUID() }),
      readAvailableShareLink: vi
        .fn()
        .mockResolvedValue({ expiresAt, startPage: "/", hosted: true }),
    })
    const legacy = createPreviewSession(buildId, "a".repeat(64), expiresAt, encryptionKey)
    const shared = createSharePreviewSession(
      { buildId, shareLinkId: randomUUID(), expiresAt },
      encryptionKey,
    )
    const host = `${buildId}.${new URL(previewBaseOrigin).host}`

    const responses = await Promise.all(
      [`replica_preview=${legacy}`, `replica_share_preview=${shared}`].map((cookie) =>
        request(path, { host, cookie, accept: "text/css" }),
      ),
    )
    expect(responses.map(({ status }) => status)).toEqual([200, 200])
    expect(responses.map(({ body }) => body)).toEqual([bytes.toString(), bytes.toString()])

    const launchHeaders = postHeaders(hubOrigin, randomBytes(32).toString("base64url"))
    const body = form({ start: "one-click", buildId })
    expect((await request(address.launch, { ...launchHeaders, host }, body)).status).toBe(404)
    expect(authority.launch).not.toHaveBeenCalled()

    const launch = await request(address.launch, launchHeaders, body)
    readAutoForm(launch, `${readerOrigin}${address.begin}`, "intent")
  })

  it("rejects private launch on an unknown host even without a configured Build host", async () => {
    const { request, authority, buildId } = await startHub()

    const launch = await request(
      address.launch,
      {
        ...postHeaders(hubOrigin, randomBytes(32).toString("base64url")),
        host: "unconfigured.example.com",
      },
      form({ start: "one-click", buildId }),
    )

    expect(launch.status).toBe(404)
    expect(launch.headers.location).toBeUndefined()
    expect(authority.launch).not.toHaveBeenCalled()
  })

  it("only lets the backend Reader credential reach the exchange authority", async () => {
    const { request, grant, access, buildId, readerSecret, authority } = await startHub()
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
    expect(JSON.parse(backend.body)).toEqual({ access, startPage: "/", buildId })
    expect(authority.exchange).toHaveBeenCalledWith(grant, address, challengeDigest)
  })
})

describe("createPrivatePreviewAuthority()", () => {
  it("authorizes the nested index first and only uses the entry point when it is absent", async () => {
    const { authority, target, sessionDigest, read, findDistFile } = authorityFixture()
    const hub = await startHub()
    hub.authority.authorizeFile.mockImplementation((...args) => authority.authorizeFile(...args))
    read.mockResolvedValue({
      buildId: target.buildId,
      sessionDigest,
      readerOrigin,
      tokenDigest: randomBytes(32).toString("hex"),
      challengeDigest: null,
      now: new Date(),
      expiresAt: new Date(Date.now() + 30_000),
    })
    const path = "dist/docs/index.html"
    const nested = { storageKey: "nested-index", byteLength: 20 }
    const entry = { storageKey: "entry-index", byteLength: 23 }
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${hub.readerSecret}`,
    }
    const body = JSON.stringify({
      repositoryId: address.repositoryId,
      runId: address.runId,
      access: hub.access,
      path,
      allowEntryPointFallback: true,
    })
    findDistFile.mockImplementation((_, requested) =>
      Promise.resolve(requested === path ? nested : requested === "dist/index.html" ? entry : null),
    )

    const direct = await hub.request(readerAuthorizePath, headers, body)

    expect(direct.status).toBe(200)
    expect(JSON.parse(direct.body)).toEqual({ ...nested, path })
    expect(findDistFile.mock.calls).toEqual([[target.buildId, path]])

    findDistFile.mockClear()
    findDistFile.mockImplementation((_, requested) =>
      Promise.resolve(requested === "dist/index.html" ? entry : null),
    )

    const fallback = await hub.request(readerAuthorizePath, headers, body)

    expect(fallback.status).toBe(200)
    expect(JSON.parse(fallback.body)).toEqual({ ...entry, path: "dist/index.html" })
    expect(findDistFile.mock.calls).toEqual([
      [target.buildId, path],
      [target.buildId, "dist/index.html"],
    ])
  })

  it.each([false, true])(
    "never looks up the preview marker for an authorized Reader (entry fallback: %s)",
    async (allowEntryPointFallback) => {
      const { authority, target, sessionDigest, read, findDistFile } = authorityFixture()
      const hub = await startHub()
      hub.authority.authorizeFile.mockImplementation((...args) => authority.authorizeFile(...args))
      read.mockResolvedValue({
        buildId: target.buildId,
        sessionDigest,
        readerOrigin,
        tokenDigest: createHash("sha256").update(hub.access).digest("hex"),
        challengeDigest: null,
        now: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
      })
      findDistFile.mockResolvedValue({ storageKey: "stored-artifact", byteLength: 20 })

      const response = await hub.request(
        readerAuthorizePath,
        {
          "content-type": "application/json",
          authorization: `Bearer ${hub.readerSecret}`,
        },
        JSON.stringify({
          repositoryId: address.repositoryId,
          runId: address.runId,
          access: hub.access,
          path: privatePreviewManifestPath,
          allowEntryPointFallback,
        }),
      )

      expect(response.status).toBe(404)
      expect(hub.authority.authorizeFile).toHaveBeenCalledWith(
        hub.access,
        address,
        privatePreviewManifestPath,
        allowEntryPointFallback,
      )
      expect(findDistFile).not.toHaveBeenCalled()
    },
  )

  it("does not issue a handoff for a dist package built for a different mount", async () => {
    const { authority, target, sessionDigest, findDistFile, readStorage, issue } =
      authorityFixture()
    const bytes = Buffer.from(JSON.stringify({ basePath: "/previews/github/901/1202/" }))
    findDistFile.mockResolvedValue({
      storageKey: "synthetic-base-manifest",
      byteLength: bytes.length,
    })
    readStorage.mockResolvedValue({ status: "ok", bytes })

    await expect(authority.launch(sessionDigest, address, target.buildId)).resolves.toBe(
      "incompatible",
    )
    await expect(
      authority.issue(sessionDigest, address, randomBytes(32).toString("hex"), {
        id: randomUUID(),
        buildId: target.buildId,
        expiresAt: new Date(Date.now() + 30_000),
      }),
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
      .mockResolvedValueOnce({ ...row, challengeDigest, now: new Date() })
      .mockResolvedValueOnce({ ...row, challengeDigest: null, now: new Date() })

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
        now: new Date(),
        expiresAt: new Date(Date.now() + 30_000),
      })
      findDistFile.mockImplementation(() => {
        if (revoked === "the Hub session") restoreSession.mockResolvedValue(null)
        else isRepositoryVisible.mockResolvedValue(false)
        return Promise.resolve({ storageKey: "synthetic-style", byteLength: 20 })
      })

      const path = "dist/style.css"
      // An ended Hub session lets the Reader send the viewer back through Hub sign-in.
      await expect(authority.authorizeFile(access, address, path, false)).resolves.toBe(
        revoked === "the Hub session" ? "session-ended" : null,
      )
      expect(findDistFile).toHaveBeenCalledWith(target.buildId, path)
    },
  )

  it("reports an ended Reader session instead of a denial so a navigation can renew", async () => {
    const { authority, target, sessionDigest, read, findDistFile, restoreSession } =
      authorityFixture()
    const access = randomBytes(32).toString("base64url")
    read.mockResolvedValueOnce(null)

    await expect(authority.authorizeFile(access, address, "dist/index.html", true)).resolves.toBe(
      "session-ended",
    )
    expect(restoreSession).not.toHaveBeenCalled()

    read.mockResolvedValueOnce({
      buildId: target.buildId,
      sessionDigest,
      readerOrigin,
      tokenDigest: randomBytes(32).toString("hex"),
      challengeDigest: null,
      now: new Date(),
      expiresAt: new Date(Date.now() - 1),
    })
    findDistFile.mockResolvedValue({ storageKey: "synthetic-index", byteLength: 20 })

    await expect(authority.authorizeFile(access, address, "dist/index.html", true)).resolves.toBe(
      "session-ended",
    )
  })

  it("issues one handoff per launch ID until its database deadline", async () => {
    const { authority, target, sessionDigest, issue, findDistFile, readStorage } =
      authorityFixture()
    const bytes = Buffer.from(JSON.stringify({ basePath: address.mount }))
    findDistFile.mockResolvedValue({ storageKey: "synthetic-manifest", byteLength: bytes.length })
    readStorage.mockResolvedValue({ status: "ok", bytes })
    issue.mockResolvedValue(true)
    const challengeDigest = randomBytes(32).toString("hex")
    const intent = {
      id: randomUUID(),
      buildId: target.buildId,
      expiresAt: new Date(Date.now() + 30_000),
    }

    await expect(authority.issue(sessionDigest, address, challengeDigest, intent)).resolves.toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    )
    expect(issue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: intent.id,
        buildId: target.buildId,
        sessionDigest,
        challengeDigest,
        expiresAt: intent.expiresAt,
      }),
    )

    issue.mockResolvedValue(false)
    await expect(
      authority.issue(sessionDigest, address, challengeDigest, intent),
    ).resolves.toBeNull()

    issue.mockClear()
    const expired = { ...intent, id: randomUUID(), expiresAt: new Date(Date.now() - 1) }
    await expect(
      authority.issue(sessionDigest, address, challengeDigest, expired),
    ).resolves.toBeNull()
    const otherBuild = { ...intent, id: randomUUID(), buildId: randomUUID() }
    await expect(
      authority.issue(sessionDigest, address, challengeDigest, otherBuild),
    ).resolves.toBeNull()
    expect(issue).not.toHaveBeenCalled()
  })

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
        now: new Date(),
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
