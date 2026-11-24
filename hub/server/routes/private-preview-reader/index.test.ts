import { createHash, randomBytes } from "node:crypto"
import { once } from "node:events"
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished, vi } from "vitest"

import { privatePreviewAddress } from "../../utils/private-preview-address"
import { createPrivatePreviewReader } from "."

const address = privatePreviewAddress("901", "1201")!
const settings = {
  hubOrigin: "https://hub.example.com",
  readerOrigin: "https://preview.example.net",
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
  const exchange = vi.fn<ReaderOptions["exchange"]>().mockResolvedValue({ access, startPage })
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

  async function signIn() {
    const begin = await request(address.begin)
    expect(begin.status).toBe(302)
    const challenge = begin.headers["set-cookie"]![0]!
    const challengeCookie = challenge.split(";")[0]!
    const grant = randomBytes(32).toString("base64url")
    const exchanged = await request(address.exchange, {
      method: "POST",
      headers: {
        origin: settings.hubOrigin,
        cookie: challengeCookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant }).toString(),
    })
    expect(exchanged.status).toBe(303)
    const cookie = exchanged.headers["set-cookie"]!.find((value) => value.includes(`=${access};`))!
    return { begin, challenge, challengeCookie, grant, exchanged, cookie }
  }

  return { request, signIn, access, exchange, authorizeFile, readArtifact }
}

describe("createPrivatePreviewReader()", () => {
  it("binds the handoff and checks documents and assets before and after each read", async () => {
    const { request, signIn, access, exchange, authorizeFile, readArtifact } = await startReader()
    const { begin, challenge, challengeCookie, grant, exchanged, cookie } = await signIn()
    const challengeDigest = createHash("sha256")
      .update(challengeCookie.slice(challengeCookie.indexOf("=") + 1))
      .digest("hex")
    const launch = new URL(begin.headers.location!)
    expect(launch.origin).toBe(settings.hubOrigin)
    expect(launch.pathname).toBe(address.launch)
    expect(launch.searchParams.get("challenge")).toBe(challengeDigest)
    expect(exchange).toHaveBeenCalledWith(grant, address, challengeDigest)
    expect(challenge).toMatch(/;\s*HttpOnly\b/i)
    expect(challenge).toMatch(/;\s*Secure\b/i)
    expect(challenge).not.toMatch(/;\s*Domain=/i)
    expect(exchanged.headers.location).toBe(address.mount)
    expect(cookie).toMatch(/;\s*HttpOnly\b/i)
    expect(cookie).toMatch(/;\s*Secure\b/i)
    expect(cookie).not.toMatch(/;\s*Domain=/i)
    const accessCookie = cookie.split(";")[0]!

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
      expect(calls).toEqual(["authorize", "read", "authorize"])
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
      expect(authorizeFile.mock.calls).toEqual([
        [access, address, candidate, true],
        [access, address, candidate, true],
      ])
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

  it("does not exchange a grant when the browser challenge cookie is absent", async () => {
    const { request, exchange } = await startReader()
    const response = await request(address.exchange, {
      method: "POST",
      headers: { origin: settings.hubOrigin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant: randomBytes(32).toString("base64url") }).toString(),
    })

    expect(response.status).toBe(404)
    expect(response.headers["set-cookie"]).toBeUndefined()
    expect(exchange).not.toHaveBeenCalled()
  })

  it.each([
    { condition: "revoked before lookup", first: false, unavailable: false, status: 404 },
    { condition: "revoked after the byte read", first: true, unavailable: false, status: 404 },
    { condition: "authority fails before lookup", first: false, unavailable: true, status: 503 },
    {
      condition: "authority fails after reading bytes",
      first: true,
      unavailable: true,
      status: 503,
    },
  ])("returns no preview bytes or 304 when $condition", async ({ first, unavailable, status }) => {
    const { request, signIn, authorizeFile, readArtifact } = await startReader()
    const { cookie } = await signIn()
    if (first) authorizeFile.mockResolvedValueOnce(asset)
    if (unavailable) authorizeFile.mockRejectedValueOnce(new Error("synthetic authority outage"))
    else authorizeFile.mockResolvedValueOnce(null)

    const response = await request(assetPath, {
      headers: { cookie: cookie.split(";")[0]!, "if-none-match": "*" },
    })

    expect(response.status).toBe(status)
    expect(response.headers["cache-control"]).toContain("no-store")
    expect(response.body).not.toContain(fixtureBytes.toString())
    expect(readArtifact).toHaveBeenCalledTimes(first ? 1 : 0)
    expect(authorizeFile).toHaveBeenCalledTimes(first ? 2 : 1)
  })

  it("only begins handoff on the configured HTTPS Reader host", async () => {
    const { request } = await startReader()

    for (const [name, value] of [
      ["x-forwarded-proto", "http"],
      ["host", new URL(settings.hubOrigin).host],
    ] as const) {
      const response = await request(address.begin, { headers: { [name]: value } })

      expect(response.status).toBe(404)
      expect(response.headers.location).toBeUndefined()
      expect(response.headers["set-cookie"]).toBeUndefined()
    }
  })
})
