import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { describe, it } from "node:test"
import { promisify } from "node:util"

import { temporaryDirectory } from "../../test/temporary-directory/index.mjs"
import { pushToHub, retryDelaySeconds } from "./index.mjs"

async function packageDirectory() {
  const root = await temporaryDirectory()
  await mkdir(path.join(root, "dist", "assets"), { recursive: true })
  await writeFile(path.join(root, "dist", "index.html"), "<h1>Home</h1>")
  await writeFile(path.join(root, "dist", "assets", "app.js"), "export {}")
  await writeFile(path.join(root, "templates.json"), '{"version":1,"templates":[]}')
  return root
}

/** Serves the OIDC token endpoint and the Hub, answering uploads from `responses`. */
async function startHub(responses) {
  const uploads = []
  const tokenRequests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      if (request.url.startsWith("/token")) {
        tokenRequests.push({ url: request.url, authorization: request.headers.authorization })
        response.end(JSON.stringify({ value: "oidc-token" }))
        return
      }
      uploads.push({ request, body: Buffer.concat(chunks) })
      const next = responses[Math.min(uploads.length, responses.length) - 1]
      if (next === "hang") return
      response.writeHead(next.status, next.headers ?? {})
      response.end(JSON.stringify(next.body ?? {}))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const hubUrl = `http://127.0.0.1:${server.address().port}`
  return {
    hubUrl,
    uploads,
    tokenRequests,
    environment: {
      ACTIONS_ID_TOKEN_REQUEST_URL: `${hubUrl}/token?api-version=2.0`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
    },
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

async function push(hub, options = {}) {
  const waits = []
  const result = await pushToHub({
    kind: "build",
    directory: await packageDirectory(),
    hubUrl: hub.hubUrl,
    environment: hub.environment,
    wait: (seconds) => waits.push(seconds),
    log: () => {},
    ...options,
  })
  return { result, waits }
}

describe("pushToHub", () => {
  it("retries a 503 and sends the package zip with an identity token for the Hub", async (t) => {
    const hub = await startHub([{ status: 503 }, { status: 201, body: { status: "imported" } }])
    t.after(hub.close)

    const { result, waits } = await push(hub)

    assert.deepEqual(result, { status: "imported" })
    assert.deepEqual(waits, [15])
    assert.equal(hub.uploads.length, 2)
    const [{ request, body }] = hub.uploads
    assert.equal(request.url, "/api/github/actions/builds")
    assert.equal(request.headers.authorization, "Bearer oidc-token")
    assert.equal(request.headers["content-type"], "application/zip")
    assert.deepEqual(
      hub.tokenRequests,
      Array.from({ length: 2 }, () => ({
        url: `/token?api-version=2.0&audience=${encodeURIComponent(hub.hubUrl)}`,
        authorization: "Bearer request-token",
      })),
    )
    const archive = path.join(await temporaryDirectory(), "package.zip")
    await writeFile(archive, body)
    const { stdout } = await promisify(execFile)("unzip", ["-Z1", archive])
    assert.deepEqual(stdout.trim().split("\n"), [
      "dist/assets/app.js",
      "dist/index.html",
      "templates.json",
    ])
    const html = await promisify(execFile)("unzip", ["-p", archive, "dist/index.html"])
    assert.equal(html.stdout, "<h1>Home</h1>")
  })

  it("honors Retry-After seconds and dates on 429", async (t) => {
    const hub = await startHub([
      { status: 429, headers: { "retry-after": "7" } },
      { status: 429, headers: { "retry-after": "30" } },
      { status: 200, body: { status: "unchanged" } },
    ])
    t.after(hub.close)

    const { waits } = await push(hub)

    assert.deepEqual(waits, [7, 30])
    const date = new Response(null, { headers: { "retry-after": "Thu, 01 Jan 2026 00:00:20 GMT" } })
    assert.equal(retryDelaySeconds(date, 0, 15, Date.parse("2026-01-01T00:00:00Z")), 20)
  })

  it("stops rather than retrying earlier than a long Retry-After", async (t) => {
    const hub = await startHub([{ status: 429, headers: { "retry-after": "3600" } }])
    t.after(hub.close)
    await assert.rejects(push(hub), /Retry-After requests 3600s.*artifact.*kept/)
    assert.equal(hub.uploads.length, 1)
  })

  it("explains an unavailable Hub once retries are exhausted", async (t) => {
    const hub = await startHub([{ status: 502 }])
    t.after(hub.close)

    await assert.rejects(push(hub, { retries: 2, retryDelay: 1 }), (error) => {
      assert.equal(
        error.message,
        `The Hub at ${hub.hubUrl} is offline or cannot be contacted (HTTP 502). Re-run this job when the Hub is available again; re-running is safe because the Hub imports each upload at most once. The replica-build-v1 artifact from this run is kept for 3 days.`,
      )
      return true
    })
    assert.equal(hub.uploads.length, 3)
  })

  it("retries connection failures and timeouts", async (t) => {
    const hub = await startHub(["hang"])
    t.after(hub.close)

    await assert.rejects(
      push(hub, { retries: 1, timeout: 1 }),
      /offline or cannot be contacted \(no response within 1s\)/,
    )
    assert.equal(hub.uploads.length, 2)

    const closed = await startHub([])
    const closedUrl = closed.hubUrl
    await closed.close()
    await assert.rejects(
      push({ ...hub, hubUrl: closedUrl }, { retries: 1 }),
      /offline or cannot be contacted \(fetch failed\)/,
    )
  })

  it("does not retry rejections and explains each one", async (t) => {
    const cases = [
      [
        401,
        { error: "invalid_token" },
        /did not accept this workflow's identity\..*id-token: write/,
      ],
      [403, { error: "forbidden" }, /does not accept Build from this workflow/],
      [413, {}, /package is larger than the Hub/],
      [
        404,
        { error: "unknown_repository" },
        /is not connected to this repository\. Connect it in the Hub/,
      ],
      [
        409,
        { error: "conflict", message: "A newer workflow run owns this Build." },
        /did not accept this Build\. A newer workflow run owns this Build\./,
      ],
      [
        422,
        { error: "invalid_package", message: "dist/index.html is missing." },
        /rejected the Build package as invalid\. dist\/index\.html is missing\./,
      ],
    ]
    for (const [status, body, message] of cases) {
      const hub = await startHub([{ status, body }])
      t.after(hub.close)
      await assert.rejects(push(hub), message)
      assert.equal(hub.uploads.length, 1, `HTTP ${status} must not be retried`)
    }

    const hub = await startHub([{ status: 409, body: { error: "digest_mismatch" } }])
    t.after(hub.close)
    await assert.rejects(
      push(hub, { kind: "screenshots" }),
      /rejected these screenshots because they were captured from a different dist/,
    )
    assert.equal(hub.uploads[0].request.url, "/api/github/actions/screenshots")
  })

  it("requires the id-token permission before uploading", async (t) => {
    const hub = await startHub([{ status: 201 }])
    t.after(hub.close)

    await assert.rejects(push(hub, { environment: {} }), /permissions: id-token: write/)
    assert.equal(hub.uploads.length, 0)
  })

  it("refuses plain HTTP outside this machine", async () => {
    await assert.rejects(
      pushToHub({ kind: "build", directory: ".", hubUrl: "http://hub.example.com" }),
      /hub-url must use https/,
    )
  })

  it("rejects malformed success responses and unsafe Hub addresses", async (t) => {
    const hub = await startHub([{ status: 200, body: {} }])
    t.after(hub.close)
    await assert.rejects(push(hub), /invalid upload response.*re-running the job is safe/)
    for (const suffix of ["/path", "/?query=1", "/#fragment"]) {
      await assert.rejects(push(hub, { hubUrl: `${hub.hubUrl}${suffix}` }), /must be an origin/)
    }
    await assert.rejects(push(hub, { retries: 6 }), /hub-retries.*from 0 to 5/)
    assert.equal(hub.uploads.length, 1)
  })
})
