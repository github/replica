import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer, type RequestListener } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it, onTestFinished } from "vitest"

import { createAuthorityClient } from "."

const exchangePath = "/api/private-preview/reader/exchange"
const filePath = "/api/private-preview/reader/file"

async function startAuthority(handler: RequestListener) {
  const server = createServer(handler).listen(0, "127.0.0.1")
  await once(server, "listening")
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo
  const secret = randomBytes(32).toString("base64url")
  return { client: createAuthorityClient(`http://127.0.0.1:${port}`, secret), secret }
}

function exchangeInput() {
  return {
    repositoryId: "901",
    runId: "1201",
    grant: randomBytes(32).toString("base64url"),
    challengeDigest: randomBytes(32).toString("hex"),
  }
}

describe("createAuthorityClient()", () => {
  it("uses authenticated POSTs and returns valid exchange and file replies", async () => {
    const exchanged = {
      access: randomBytes(32).toString("base64url"),
      startPage: "/",
      buildId: randomUUID(),
    }
    const file = { storageKey: "sample-artifact", byteLength: 12, path: "dist/index.html" }
    const requests: {
      path: string | undefined
      method: string | undefined
      authorization: string | undefined
      contentType: string | undefined
      body: string
    }[] = []
    const { client, secret } = await startAuthority((request, response) => {
      request.setEncoding("utf8")
      let body = ""
      request.on("data", (chunk: string) => {
        body += chunk
      })
      request.on("end", () => {
        requests.push({
          path: request.url,
          method: request.method,
          authorization: request.headers.authorization,
          contentType: request.headers["content-type"],
          body,
        })
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify(request.url === exchangePath ? exchanged : file))
      })
    })
    const exchange = exchangeInput()
    const fileInput = {
      repositoryId: exchange.repositoryId,
      runId: exchange.runId,
      access: exchanged.access,
      path: file.path,
      allowEntryPointFallback: false,
    }

    await expect(client.exchange(exchangePath, exchange)).resolves.toEqual(exchanged)
    await expect(client.authorizeFile(filePath, fileInput)).resolves.toEqual(file)
    expect(
      requests.map(({ body, ...headers }) => ({ ...headers, body: JSON.parse(body) as unknown })),
    ).toEqual(
      [
        { path: exchangePath, body: exchange },
        { path: filePath, body: fileInput },
      ].map(({ path, body }) => ({
        path,
        method: "POST",
        authorization: `Bearer ${secret}`,
        contentType: "application/json",
        body,
      })),
    )
  })

  it.each([
    { status: 404, outcome: "a denial" },
    { status: 503, outcome: "an unavailable authority" },
  ])("treats a $status reply as $outcome", async ({ status }) => {
    const reply = { access: randomBytes(32).toString("base64url"), startPage: "/" }
    const { client } = await startAuthority((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(reply))
    })

    const result = client.exchange(exchangePath, exchangeInput())

    if (status === 404) await expect(result).resolves.toBeNull()
    else await expect(result).rejects.toThrow("Private preview authority is unavailable.")
  })

  it("reports an ended reader session only when Hub marks the file denial", async () => {
    const fileInput = {
      repositoryId: "901",
      runId: "1201",
      access: randomBytes(32).toString("base64url"),
      path: "dist/index.html",
      allowEntryPointFallback: true,
    }
    for (const [headers, expected] of [
      [{ "x-replica-preview-session-ended": "1" }, "session-ended"],
      [{}, null],
    ] as const) {
      const { client } = await startAuthority((_request, response) => {
        response.writeHead(404, headers)
        response.end()
      })

      await expect(client.authorizeFile("/file", fileInput)).resolves.toBe(expected)
    }
  })

  it("does not follow a redirect from the configured authority", async () => {
    const paths: (string | undefined)[] = []
    const { client } = await startAuthority((request, response) => {
      paths.push(request.url)
      if (request.url === exchangePath) response.writeHead(307, { location: "/other-endpoint" })
      else response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({ access: randomBytes(32).toString("base64url"), startPage: "/" }),
      )
    })

    await expect(client.exchange(exchangePath, exchangeInput())).rejects.toThrow()
    expect(paths).toEqual([exchangePath])
  })

  it("rejects a valid JSON reply that exceeds the byte limit", async () => {
    const reply = JSON.stringify({ access: randomBytes(32).toString("base64url"), startPage: "/" })
    const { client } = await startAuthority((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(reply.padEnd(8 * 1024 + 1))
    })

    await expect(client.exchange(exchangePath, exchangeInput())).rejects.toThrow(
      "Private preview authority response is too large.",
    )
  })

  it("rejects an exchange reply with an unexpected field", async () => {
    const reply = { access: randomBytes(32).toString("base64url"), startPage: "/", extra: true }
    const { client } = await startAuthority((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(reply))
    })

    await expect(client.exchange(exchangePath, exchangeInput())).rejects.toThrow()
  })

  it("rejects file metadata with an invalid recorded length", async () => {
    const file = { storageKey: "sample-artifact", byteLength: -1, path: "dist/index.html" }
    const { client } = await startAuthority((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify(file))
    })

    await expect(
      client.authorizeFile(filePath, {
        repositoryId: "901",
        runId: "1201",
        access: randomBytes(32).toString("base64url"),
        path: file.path,
        allowEntryPointFallback: false,
      }),
    ).rejects.toThrow()
  })
})
