import { createHash, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { createLaunchProof } from "../../domains/private-preview/create-launch-proof"
import { privatePreviewAddress } from "../../utils/private-preview-address"
import { createPrivatePreviewReader } from "."

const address = privatePreviewAddress("901", "1201")!
const settings = {
  hubOrigin: "https://hub.example.com",
  readerOrigin: "https://preview.example.net",
  readerSecret: randomBytes(32).toString("base64url"),
}
const proof = createLaunchProof(settings)
const buildId = randomUUID()
const formHeaders = {
  origin: settings.hubOrigin,
  "content-type": "application/x-www-form-urlencoded",
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function cookiePair(header: string) {
  return header.split(";")[0]!
}

function cookieValue(header: string) {
  const pair = cookiePair(header)
  return pair.slice(pair.indexOf("=") + 1)
}

function navigationHeaders(...cookies: string[]) {
  return {
    cookie: cookies.map(cookiePair).join("; "),
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
  }
}

function formValue(body: string, action: string, field: string) {
  expect(body).toContain(`<form method="post" action="${action}">`)
  return body.match(new RegExp(`name="${field}" value="([^"]+)"`))?.[1]
}
const assetPath = `${address.mount}style.css`
const fixtureBytes = Buffer.from("body { color: black; }")
const asset = {
  storageKey: "synthetic-css",
  byteLength: fixtureBytes.length,
  path: "dist/style.css",
}

async function startReader(startPage = "/") {
  type ReaderOptions = Parameters<typeof createPrivatePreviewReader>[0]
  const access = randomBytes(32).toString("base64url")
  const exchange = vi
    .fn<ReaderOptions["exchange"]>()
    .mockResolvedValue({ access, startPage, buildId })
  const authorizeFile = vi.fn<ReaderOptions["authorizeFile"]>().mockResolvedValue(asset)
  const readArtifact = vi
    .fn<ReaderOptions["readArtifact"]>()
    .mockResolvedValue({ status: "ok", bytes: fixtureBytes })
  const app = createPrivatePreviewReader({
    settings,
    trustedProxyHops: 1,
    exchange,
    authorizeFile,
    readArtifact,
  })
  const server = createServer(app).listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo

  function request(
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const outgoing = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path,
            method: options.method,
            headers: {
              host: new URL(settings.readerOrigin).host,
              "x-forwarded-proto": "https",
              ...options.headers,
            },
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
        outgoing.end(options.body)
      },
    )
  }

  async function begin(intent = proof.start(address, buildId, digest("session"), new Date())) {
    return request(address.begin, {
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ intent }).toString(),
    })
  }

  function exchangeTicket(ticket: string, cookie?: string) {
    return request(address.exchange, {
      method: "POST",
      headers: { ...formHeaders, ...(cookie ? { cookie } : {}) },
      body: new URLSearchParams({ grant: ticket }).toString(),
    })
  }

  async function signIn() {
    const begun = await begin()
    expect(begun.status).toBe(200)
    const challenge = begun.headers["set-cookie"]![0]!
    const continuation = formValue(
      begun.body,
      `${settings.hubOrigin}${address.launchReturn}`,
      "continuation",
    )!
    const { id } = proof.read(continuation, address)!
    const grant = randomBytes(32).toString("base64url")
    const exchanged = await exchangeTicket(`${id}.${grant}`, cookiePair(challenge))
    expect(exchanged.status).toBe(303)
    const cookies = exchanged.headers["set-cookie"]!
    const cookie = cookies.find((value) => value.includes(`=${access};`))!
    const marker = cookies.find((value) => value.startsWith("__Host-replica-preview-build-"))!
    return { begun, challenge, continuation, id, grant, exchanged, cookie, marker }
  }

  return { request, begin, exchangeTicket, signIn, access, exchange, authorizeFile, readArtifact }
}

describe("createPrivatePreviewReader()", () => {
  it("binds the handoff and checks each document and asset once before its bounded read", async () => {
    const { request, signIn, access, exchange, authorizeFile, readArtifact } = await startReader()
    const { challenge, continuation, id, grant, exchanged, cookie, marker } = await signIn()
    const challengeDigest = digest(cookieValue(challenge))
    expect(proof.read(continuation, address)?.challenge).toBe(challengeDigest)
    expect(exchange).toHaveBeenCalledWith(grant, address, challengeDigest)
    expect(challenge).toMatch(new RegExp(`^__Host-replica-preview-challenge-${id}=`))
    expect(challenge).toMatch(/;\s*SameSite=None\b/i)
    expect(exchanged.headers.location).toBe(address.mount)
    expect(exchanged.headers["set-cookie"]).toContainEqual(
      expect.stringMatching(new RegExp(`^__Host-replica-preview-challenge-${id}=;.*Expires=`)),
    )
    expect(cookie).toMatch(/;\s*Max-Age=28800\b/i)
    expect(cookie).toMatch(/;\s*SameSite=Lax\b/i)
    expect(marker).toMatch(/;\s*Max-Age=86400\b/i)
    for (const header of [challenge, cookie, marker]) {
      expect(header).toMatch(/;\s*HttpOnly\b/i)
      expect(header).toMatch(/;\s*Secure\b/i)
      expect(header).toMatch(/;\s*Path=\/(?:;|$)/i)
      expect(header).not.toMatch(/;\s*Domain=/i)
    }
    const accessCookie = cookiePair(cookie)

    const html = Buffer.from("<!doctype html><title>Synthetic preview</title>")
    const files = [
      {
        url: address.mount,
        destination: "document",
        path: "dist/index.html",
        storageKey: "synthetic-html",
        bytes: html,
        type: /^text\/html\b/,
      },
      {
        url: assetPath,
        destination: "style",
        path: asset.path,
        storageKey: asset.storageKey,
        bytes: fixtureBytes,
        type: /^text\/css\b/,
      },
    ]
    for (const { url, destination, path, storageKey, bytes, type } of files) {
      const calls: string[] = []
      authorizeFile.mockImplementation(() => {
        calls.push("authorize")
        return Promise.resolve({ storageKey, path, byteLength: bytes.length })
      })
      readArtifact.mockImplementation(() => {
        calls.push("read")
        return Promise.resolve({ status: "ok", bytes })
      })

      const response = await request(url, {
        headers: { cookie: accessCookie, "sec-fetch-dest": destination },
      })

      expect(response.status).toBe(200)
      expect(response.headers["content-type"]).toMatch(type)
      expect(response.headers["cache-control"]).toContain("no-store")
      expect(response.body).toBe(bytes.toString())
      if (destination === "document") {
        const directives = String(response.headers["content-security-policy"])
          .split(";")
          .map((directive) => directive.trim())
        expect(directives.filter((directive) => directive.startsWith("worker-src "))).toEqual([
          "worker-src 'none'",
        ])
        expect(directives.filter((directive) => directive.startsWith("base-uri "))).toEqual([
          "base-uri 'none'",
        ])
      }
      expect(calls).toEqual(["authorize", "read"])
      expect(authorizeFile).toHaveBeenLastCalledWith(
        access,
        address,
        path,
        destination === "document",
      )
      expect(readArtifact).toHaveBeenLastCalledWith(
        storageKey,
        bytes.length,
        expect.any(AbortSignal),
      )
    }
  })

  it("does not accept an unrelated Hub cookie or read an anonymous asset", async () => {
    const { request, authorizeFile, readArtifact } = await startReader()

    const response = await request(assetPath, { headers: { cookie: "hub_session=synthetic" } })

    expect(response.status).toBe(404)
    expect(response.body).not.toContain(fixtureBytes.toString())
    expect(authorizeFile).not.toHaveBeenCalled()
    expect(readArtifact).not.toHaveBeenCalled()
  })

  it.each([
    { startPage: "/docs", candidate: "dist/docs" },
    { startPage: "/docs/", candidate: "dist/docs/index.html" },
  ])(
    "allows the entry point when the $startPage start document is absent",
    async ({ startPage, candidate }) => {
      const { request, signIn, access, authorizeFile, readArtifact } = await startReader(startPage)
      const { exchanged, cookie } = await signIn()
      const bytes = Buffer.from("<!doctype html><title>Synthetic entry point</title>")
      authorizeFile.mockResolvedValue({
        path: "dist/index.html",
        storageKey: "synthetic-entry",
        byteLength: bytes.length,
      })
      readArtifact.mockResolvedValue({ status: "ok", bytes })
      expect(exchanged.headers.location).toBe(`${address.mount}${startPage.slice(1)}`)

      const response = await request(exchanged.headers.location!, {
        headers: { cookie: cookie.split(";")[0]!, "sec-fetch-dest": "document" },
      })

      expect(response.status).toBe(200)
      expect(response.body).toBe(bytes.toString())
      expect(authorizeFile.mock.calls).toEqual([[access, address, candidate, true]])
    },
  )

  it("does not treat a missing explicit HTML file as a document route", async () => {
    const { request, signIn, access, authorizeFile, readArtifact } = await startReader()
    const { cookie } = await signIn()
    authorizeFile.mockResolvedValue(null)

    const response = await request(`${address.mount}docs/index.html`, {
      headers: { cookie: cookie.split(";")[0]!, "sec-fetch-dest": "document" },
    })

    expect(response.status).toBe(404)
    expect(authorizeFile).toHaveBeenCalledExactlyOnceWith(
      access,
      address,
      "dist/docs/index.html",
      false,
    )
    expect(readArtifact).not.toHaveBeenCalled()
  })

  it("does not exchange a grant without the challenge cookie for that launch", async () => {
    const { begin, exchangeTicket, exchange } = await startReader()
    const first = await begin()
    const second = await begin()
    const secondId = proof.read(
      formValue(second.body, `${settings.hubOrigin}${address.launchReturn}`, "continuation")!,
      address,
    )!.id
    const grant = randomBytes(32).toString("base64url")

    for (const [ticket, cookie] of [
      [`${secondId}.${grant}`, undefined],
      [`${secondId}.${grant}`, cookiePair(first.headers["set-cookie"]![0]!)],
      [grant, cookiePair(second.headers["set-cookie"]![0]!)],
    ] as const) {
      const response = await exchangeTicket(ticket, cookie)
      expect(response.status).toBe(404)
      expect(response.headers["set-cookie"]).toBeUndefined()
    }
    expect(exchange).not.toHaveBeenCalled()
  })

  it("limits pending launches in one browser", async () => {
    const { request } = await startReader()
    const pending = Array.from(
      { length: 12 },
      () =>
        `__Host-replica-preview-challenge-${randomUUID()}=${randomBytes(32).toString("base64url")}`,
    ).join("; ")

    const response = await request(address.begin, {
      method: "POST",
      headers: { ...formHeaders, cookie: pending },
      body: new URLSearchParams({
        intent: proof.start(address, buildId, digest("session"), new Date()),
      }).toString(),
    })

    expect(response.status).toBe(429)
    expect(response.headers["set-cookie"]).toBeUndefined()
  })

  it.each([
    { reason: "access cookie is missing", ended: false },
    { reason: "Hub reports the session ended", ended: true },
  ])(
    "silently renews a prototype navigation to its route and query when the $reason",
    async ({ ended }) => {
      const { request, exchangeTicket, signIn, exchange, authorizeFile } = await startReader()
      const { cookie, marker } = await signIn()
      if (ended) authorizeFile.mockResolvedValueOnce("session-ended")
      const page = "/checkout/?step=2"

      const navigation = await request(`${address.mount}${page.slice(1)}`, {
        headers: {
          cookie: [ended ? cookiePair(cookie) : null, cookiePair(marker)]
            .filter(Boolean)
            .join("; "),
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
        },
      })

      expect(navigation.status).toBe(200)
      const token = formValue(
        navigation.body,
        `${settings.hubOrigin}${address.launchReturn}`,
        "resume",
      )!
      const resume = proof.readResume(token, address)!
      expect(resume).toMatchObject({ buildId, page })
      const resumeCookie = navigation.headers["set-cookie"]![0]!
      expect(resumeCookie).toMatch(new RegExp(`^__Host-replica-preview-resume-${resume.id}=`))
      expect(resumeCookie).toMatch(/;\s*SameSite=None\b/i)
      expect(resume.challenge).toBe(digest(cookieValue(resumeCookie).split(".")[0]!))

      const grant = randomBytes(32).toString("base64url")
      const renewed = await exchangeTicket(`${resume.id}.${grant}`, cookiePair(resumeCookie))

      expect(renewed.status).toBe(303)
      expect(renewed.headers.location).toBe(`${address.mount}${page.slice(1)}`)
      expect(exchange).toHaveBeenLastCalledWith(grant, address, resume.challenge)
    },
  )

  it("does not exchange a renewal after its signed Reader deadline", async () => {
    const { request, exchangeTicket, signIn, exchange } = await startReader()
    const { marker } = await signIn()
    const navigation = await request(address.mount, {
      headers: {
        cookie: cookiePair(marker),
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
      },
    })
    const token = formValue(
      navigation.body,
      `${settings.hubOrigin}${address.launchReturn}`,
      "resume",
    )!
    const { id, expiresAt } = proof.readResume(token, address)!
    exchange.mockClear()
    vi.spyOn(Date, "now").mockReturnValue(expiresAt.getTime())

    const renewed = await exchangeTicket(
      `${id}.${randomBytes(32).toString("base64url")}`,
      cookiePair(navigation.headers["set-cookie"]![0]!),
    )

    expect(renewed.status).toBe(404)
    expect(exchange).not.toHaveBeenCalled()
  })

  it("does not open a renewal whose signed state expires while Hub exchanges it", async () => {
    const { request, exchangeTicket, signIn, exchange, access } = await startReader()
    const { marker } = await signIn()
    const navigation = await request(address.mount, { headers: navigationHeaders(marker) })
    const token = formValue(
      navigation.body,
      `${settings.hubOrigin}${address.launchReturn}`,
      "resume",
    )!
    const { id, expiresAt } = proof.readResume(token, address)!
    exchange.mockImplementationOnce(() => {
      vi.spyOn(Date, "now").mockReturnValue(expiresAt.getTime())
      return Promise.resolve({ access, startPage: "/", buildId })
    })

    const renewed = await exchangeTicket(
      `${id}.${randomBytes(32).toString("base64url")}`,
      cookiePair(navigation.headers["set-cookie"]![0]!),
    )

    expect(exchange).toHaveBeenCalled()
    expect(renewed.status).toBe(404)
    expect(renewed.headers["set-cookie"]).toBeUndefined()
  })

  it("limits pending renewals in one browser", async () => {
    const { request, signIn } = await startReader()
    const { marker } = await signIn()
    const pending = [randomUUID(), randomUUID()].map(
      (id) => `__Host-replica-preview-resume-${id}=pending`,
    )

    const response = await request(address.mount, {
      headers: {
        ...navigationHeaders(marker),
        cookie: [cookiePair(marker), ...pending].join("; "),
      },
    })

    expect(response.status).toBe(404)
    expect(response.headers["set-cookie"]).toBeUndefined()
  })

  it("keeps at most eight Builds' cookies by clearing the oldest other Builds", async () => {
    const { begin, exchangeTicket } = await startReader()
    const others = Array.from({ length: 8 }, (_, index) => {
      const other = privatePreviewAddress("902", String(2000 + index))!
      const marker = proof.identifyBuild(other, randomUUID(), Date.now() + (index + 1) * 60_000)
      return {
        access: `__Host-replica-preview-${other.repositoryId}-${other.runId}`,
        marker: `__Host-replica-preview-build-${other.repositoryId}-${other.runId}`,
        cookies: [
          `__Host-replica-preview-${other.repositoryId}-${other.runId}=${randomBytes(32).toString("base64url")}`,
          `__Host-replica-preview-build-${other.repositoryId}-${other.runId}=${marker}`,
        ],
      }
    })
    const begun = await begin()
    const continuation = formValue(
      begun.body,
      `${settings.hubOrigin}${address.launchReturn}`,
      "continuation",
    )!
    const { id } = proof.read(continuation, address)!

    const exchanged = await exchangeTicket(
      `${id}.${randomBytes(32).toString("base64url")}`,
      [
        cookiePair(begun.headers["set-cookie"]![0]!),
        ...others.flatMap(({ cookies }) => cookies),
      ].join("; "),
    )

    expect(exchanged.status).toBe(303)
    const cleared = exchanged.headers["set-cookie"]!.filter((header) =>
      /^[^=]+=;/.test(header),
    ).map((header) => header.slice(0, header.indexOf("=")))
    expect(cleared.sort()).toEqual(
      [others[0]!.access, others[0]!.marker, `__Host-replica-preview-challenge-${id}`].sort(),
    )
  })

  it("does not renew into a different Build than the one this browser opened", async () => {
    const { request, exchangeTicket, signIn, exchange } = await startReader()
    const { marker } = await signIn()
    const navigation = await request(address.mount, {
      headers: {
        cookie: cookiePair(marker),
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
      },
    })
    const token = formValue(
      navigation.body,
      `${settings.hubOrigin}${address.launchReturn}`,
      "resume",
    )!
    const { id } = proof.readResume(token, address)!
    exchange.mockResolvedValueOnce({
      access: randomBytes(32).toString("base64url"),
      startPage: "/",
      buildId: randomUUID(),
    })

    const renewed = await exchangeTicket(
      `${id}.${randomBytes(32).toString("base64url")}`,
      cookiePair(navigation.headers["set-cookie"]![0]!),
    )

    expect(renewed.status).toBe(404)
    expect(renewed.headers["set-cookie"]).toBeUndefined()
  })

  it.each([
    { reason: "an outside navigation", site: "cross-site", destination: "document", marker: true },
    { reason: "a typed address", site: "none", destination: "document", marker: true },
    { reason: "an asset request", site: "same-origin", destination: "style", marker: true },
    {
      reason: "a Build this browser never opened",
      site: "same-origin",
      destination: "document",
      marker: false,
    },
  ])(
    "does not renew or show an interstitial for $reason",
    async ({ site, destination, marker }) => {
      const { request, signIn, authorizeFile } = await startReader()
      const { marker: markerCookie } = await signIn()

      const response = await request(address.mount, {
        headers: {
          ...(marker ? { cookie: cookiePair(markerCookie) } : {}),
          "sec-fetch-dest": destination,
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": site,
        },
      })

      expect(response.status).toBe(404)
      expect(response.body).not.toContain("<form")
      expect(response.body).not.toContain(settings.hubOrigin)
      expect(response.headers["set-cookie"]).toBeUndefined()
      expect(authorizeFile).not.toHaveBeenCalled()
    },
  )

  it.each([
    { condition: "access is revoked", unavailable: false, status: 404 },
    { condition: "the authority fails", unavailable: true, status: 503 },
  ])("returns no preview bytes or 304 when $condition", async ({ unavailable, status }) => {
    const { request, signIn, authorizeFile, readArtifact } = await startReader()
    const { cookie } = await signIn()
    if (unavailable) authorizeFile.mockRejectedValueOnce(new Error("synthetic authority outage"))
    else authorizeFile.mockResolvedValueOnce(null)

    const response = await request(assetPath, {
      headers: { cookie: cookie.split(";")[0]!, "if-none-match": "*" },
    })

    expect(response.status).toBe(status)
    expect(response.headers["cache-control"]).toContain("no-store")
    expect(response.body).not.toContain(fixtureBytes.toString())
    expect(readArtifact).not.toHaveBeenCalled()
    expect(authorizeFile).toHaveBeenCalledOnce()
  })

  it("only begins handoff on the configured HTTPS Reader host", async () => {
    const { request } = await startReader()

    for (const [name, value] of [
      ["x-forwarded-proto", "http"],
      ["host", new URL(settings.hubOrigin).host],
    ] as const) {
      const response = await request(address.begin, {
        method: "POST",
        headers: { ...formHeaders, [name]: value },
        body: new URLSearchParams({
          intent: proof.start(address, buildId, digest("session"), new Date()),
        }).toString(),
      })

      expect(response.status).toBe(404)
      expect(response.headers.location).toBeUndefined()
      expect(response.headers["set-cookie"]).toBeUndefined()
    }
  })
})
