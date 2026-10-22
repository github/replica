import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { createCanvasContext, currentCanvasContext } from "../create-canvas-context/index.mjs"
import { InvalidHubOrigin } from "../invalid-hub-origin/index.mjs"
import { normalizeHubOrigin } from "../normalize-hub-origin/index.mjs"
import { normalizeSelectedHubOrigin } from "../normalize-selected-hub-origin/index.mjs"

import { createHubClient } from "./index.mjs"

describe("normalizeSelectedHubOrigin()", () => {
  it("converts manually selected Hub URLs to origins and preserves ports", () => {
    for (const [value, origin] of [
      ["https://hub.example.com/repositories/123", "https://hub.example.com"],
      [
        " https://hub.example.com:8443/repositories/123?tab=builds#latest ",
        "https://hub.example.com:8443",
      ],
      ["https://hub.example.com?tab=builds", "https://hub.example.com"],
      ["https://hub.example.com#latest", "https://hub.example.com"],
      ["https://hub.example.com/", "https://hub.example.com"],
      ["http://localhost:19500/repositories/1?tab=builds#latest", "http://localhost:19500"],
      ["http://127.0.0.1:19500/repositories/1", "http://127.0.0.1:19500"],
      ["http://replica.localhost:19500/repositories/1", "http://replica.localhost:19500"],
    ]) {
      assert.equal(normalizeSelectedHubOrigin(value), origin)
    }
  })

  it("rejects invalid URLs, credentials, other schemes and unsupported HTTP hosts", () => {
    for (const value of [
      "not a URL",
      "",
      "https://",
      "https://hub.example.com:invalid/path",
      "https://user@hub.example.com/path",
      "https://:password@hub.example.com/path",
      "https://user:password@localhost:19500/path",
      "ftp://hub.example.com/path",
      "file:///path",
      "javascript:alert(1)",
      "http://hub.example.com/path",
      "http://localhost.example.com/path",
      "http://[::1]:19500/path",
      null,
    ]) {
      assert.throws(() => normalizeSelectedHubOrigin(value), InvalidHubOrigin)
    }
  })
})

describe("normalizeHubOrigin()", () => {
  it("keeps trusted origins and Hub clients strict even when manual selections accept full URLs", () => {
    assert.equal(
      normalizeHubOrigin("https://hub.example.com:8443/"),
      "https://hub.example.com:8443",
    )
    assert.equal(
      normalizeHubOrigin("http://replica.localhost:19500"),
      "http://replica.localhost:19500",
    )
    for (const value of [
      "https://hub.example.com/repositories/123",
      "https://hub.example.com/?tab=builds",
      "https://hub.example.com/#latest",
      "https://user:password@hub.example.com",
      "http://hub.example.com",
      "ftp://hub.example.com",
      "not a URL",
    ]) {
      assert.throws(() => normalizeHubOrigin(value), InvalidHubOrigin)
      assert.throws(() => createHubClient({}, { origin: value }), InvalidHubOrigin)
    }
  })

  it("rejects a full URL in the environment origin", () => {
    const previous = process.env.REPLICA_HUB_ORIGIN
    try {
      process.env.REPLICA_HUB_ORIGIN = "https://hub.example.com/repositories/123"
      assert.throws(() => createHubClient({}), InvalidHubOrigin)
    } finally {
      if (previous === undefined) delete process.env.REPLICA_HUB_ORIGIN
      else process.env.REPLICA_HUB_ORIGIN = previous
    }
  })
})

describe("createHubClient()", () => {
  it("pins connection identity through reads and renewal retries and reports dispatch phase", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    const directory = path.join(workspace, "credentials")
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const originalPath = process.env.PATH
    const calls = []
    let mode = "success"
    let credential
    let credentialPath
    async function save(changes) {
      credential = { ...credential, ...changes }
      await writeFile(credentialPath, JSON.stringify(credential), {
        mode: 0o600,
      })
    }
    const server = createServer(async (request, response) => {
      if (mode !== "unversioned")
        response.setHeader("X-Replica-Canvas-Version", mode === "incompatible" ? "99" : "1")
      for await (const chunk of request) void chunk
      calls.push({
        route: request.url,
        method: request.method,
        auth: request.headers.authorization,
      })
      let status = 200
      let result = {}
      if (request.url === "/api/canvas/connection/renewal") {
        result = {
          repository: "github/replica",
          accessToken: "rotated",
          connectionId: "connection-1",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
      } else if (mode === "switch-on-rejection") {
        await save({ connectionId: "connection-2", token: "other-user" })
        status = 401
      } else if (mode === "rotate-on-rejection") {
        mode = "success"
        status = 401
      } else if (mode === "change-checkout") {
        process.env.TEST_BRANCH = "prototype/other"
      } else if (request.url.startsWith("/api/canvas/prototype?")) {
        result = {
          id: 4,
          repositoryId: 5,
          branch: "prototype/first",
          registered: false,
          canEdit: true,
          canRegister: true,
          build: { commitSha: "1".padStart(40, "0") },
        }
      }
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(result))
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      await writeFile(
        path.join(workspace, "git"),
        `#!/bin/sh
case "$1:$2" in
  remote:get-url) echo https://github.com/github/replica.git ;;
  branch:--show-current) echo "\${TEST_BRANCH:-prototype/first}" ;;
  rev-parse:HEAD) printf '%040d\\n' 1 ;;
esac
`,
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`
      const origin = `http://127.0.0.1:${server.address().port}`
      credentialPath = path.join(
        directory,
        `${createHash("sha256").update(`${origin}\ngithub/replica`).digest("hex")}.json`,
      )
      await save({
        origin,
        repository: "github/replica",
        token: "original",
        refreshToken: "refresh",
        connectionId: "connection-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      const hub = createHubClient({ repositoryPath: workspace }, { origin, directory })
      const options = {
        expectedTarget: {
          repository: "github/replica",
          branch: "prototype/first",
        },
        connectionScope: {},
      }
      await hub.request("/api/canvas/prototype?branch=prototype/first", options)
      const status = await hub.status({ register: false, ...options })
      assert.equal(status.state, "connected")
      assert.equal(status.prototype.registered, false)
      assert.equal(
        calls.some(({ method }) => method === "PATCH"),
        false,
      )
      mode = "unversioned"
      assert.deepEqual(await hub.request("/api/canvas/comments", options), {})
      mode = "incompatible"
      await assert.rejects(hub.request("/api/canvas/comments", options), {
        code: "incompatible_canvas_interface",
      })
      mode = "rotate-on-rejection"
      await hub.request("/api/canvas/comments", options)
      assert.equal(calls.at(-1).auth, "Bearer rotated")
      assert.equal(calls.filter(({ route }) => route.endsWith("/renewal")).length, 1)
      await save({ connectionId: "connection-2", token: "other-user" })
      const beforeSwitch = calls.length
      await assert.rejects(hub.request("/api/canvas/comments", options), {
        code: "stale_comment_target",
        deliveryPhase: "before_dispatch",
      })
      assert.equal(calls.length, beforeSwitch)
      await save({ connectionId: "connection-1", token: "original" })
      mode = "switch-on-rejection"
      await assert.rejects(hub.request("/api/canvas/comments", options), {
        code: "stale_comment_target",
        deliveryPhase: "after_dispatch",
      })
      assert.equal(calls.filter(({ route }) => route.endsWith("/renewal")).length, 1)
      await save({
        connectionId: "connection-1",
        token: "original",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        retryAfter: Date.now() + 30_000,
        retryStatus: 503,
      })
      await assert.rejects(hub.request("/api/canvas/replies", { ...options, method: "POST" }), {
        statusCode: 503,
        deliveryPhase: "before_dispatch",
      })
      await save({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        retryAfter: 0,
      })
      mode = "change-checkout"
      await assert.rejects(hub.request("/api/canvas/replies", { ...options, method: "POST" }), {
        code: "stale_comment_target",
        deliveryPhase: "after_dispatch",
      })
      const beforeStale = calls.length
      await assert.rejects(hub.request("/api/canvas/replies", { ...options, method: "POST" }), {
        code: "stale_comment_target",
        deliveryPhase: "before_dispatch",
      })
      assert.equal(calls.length, beforeStale)
    } finally {
      process.env.PATH = originalPath
      delete process.env.TEST_BRANCH
      await new Promise((resolve) => server.close(resolve))
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("uses an explicit local repository only for the matching development checkout", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    const repositoryPath = path.join(workspace, ".local/prototypes/example")
    await mkdir(repositoryPath, { recursive: true })
    try {
      execFileSync("git", ["init", "-b", "main", repositoryPath], {
        stdio: "ignore",
      })
      const client = createHubClient(
        {
          repositoryPath,
          target: { repository: "local/example" },
        },
        { origin: "http://replica.localhost:19500" },
      )
      assert.equal((await client.checkout()).repository, "local/example")
      const mismatched = createHubClient(
        {
          repositoryPath,
          target: { repository: "local/another" },
        },
        { origin: "http://replica.localhost:19500" },
      )
      assert.equal((await mismatched.checkout()).repository, null)
      execFileSync("git", [
        "-C",
        repositoryPath,
        "remote",
        "add",
        "origin",
        "https://github.com/github/replica.git",
      ])
      assert.equal((await client.checkout()).repository, "local/example")
      const remote = createHubClient(
        { repositoryPath, target: { repository: "local/example" } },
        { origin: "https://hub.example.com" },
      )
      assert.equal((await remote.checkout()).repository, "github/replica")
      execFileSync("git", [
        "-C",
        repositoryPath,
        "symbolic-ref",
        "HEAD",
        "refs/heads/prototype/first",
      ])
      const context = await createCanvasContext({
        prototypeUrl: "http://localhost:3000",
        repository: "local/example",
        branch: "prototype/first",
        sessionWorkspacePath: workspace,
        repositoryPath,
      })
      execFileSync("git", ["-C", repositoryPath, "symbolic-ref", "HEAD", "refs/heads/main"])
      const current = await currentCanvasContext(context)
      assert.equal(current.target.repository, "local/example")
      assert.equal(current.target.branch, "main")
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it("pairs once, stores a private repository grant, follows the checkout and revokes it", async () => {
    const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
    await mkdir(workspace, { recursive: true })
    const originalPath = process.env.PATH
    const calls = []
    let missingRepository = true
    const server = createServer(async (request, response) => {
      response.setHeader("X-Replica-Canvas-Version", "1")
      let body = ""
      for await (const chunk of request) body += chunk.toString()
      calls.push({
        url: request.url,
        method: request.method,
        auth: request.headers.authorization,
        body,
      })
      function json(body, status = 200) {
        response.writeHead(status, { "Content-Type": "application/json" })
        response.end(JSON.stringify(body))
      }
      if (request.url === "/api/canvas/pairings" && request.method === "POST") {
        if (missingRepository) {
          json({}, 404)
          return
        }
        json(
          {
            deviceCode: "device",
            userCode: "ABCD",
            verificationUrl: `http://127.0.0.1:${server.address().port}/canvas/pair/ABCD`,
          },
          201,
        )
      } else if (request.url === "/api/canvas/pairings/token" && request.method === "POST") {
        assert.deepEqual(JSON.parse(body), { device_code: "device" })
        json({
          status: "approved",
          accessToken: "hub-secret",
          repository: "github/replica",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          login: "octocat",
        })
      } else if (request.url?.startsWith("/api/canvas/prototype?")) {
        json({
          id: 4,
          repositoryId: 5,
          branch: new URL(request.url, "http://localhost").searchParams.get("branch"),
        })
      } else if (request.url === "/api/canvas/cable_ticket") {
        json({
          cableUrl: `ws://127.0.0.1:${server.address().port}/cable`,
          protocol: "replica-canvas.signed-ticket",
        })
      } else if (request.url === "/api/canvas/connection" && request.method === "DELETE") {
        response.writeHead(204)
        response.end()
      } else {
        json({ error: "Unexpected request." }, 404)
      }
    })
    server.on("upgrade", (request, socket) => {
      assert.equal(request.headers.origin, undefined)
      assert.match(request.headers["sec-websocket-protocol"], /replica-canvas\.signed-ticket/)
      const accept = createHash("sha1")
        .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64")
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: actioncable-v1-json\r\n\r\n`,
      )
      socket.once("data", () => {
        const identifier = JSON.stringify({
          channel: "ReviewCommentsChannel",
          repositoryId: 5,
          prototypeId: 4,
        })
        const payload = Buffer.from(
          JSON.stringify({
            identifier,
            message: { type: "review_comments_changed" },
          }),
        )
        socket.write(
          Buffer.concat([
            Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]),
            payload,
          ]),
        )
        setTimeout(() => socket.end(), 100)
      })
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      await writeFile(
        path.join(workspace, "git"),
        `#!/bin/sh
case "$1:$2" in
  remote:get-url) echo https://github.com/github/replica.git ;;
  branch:--show-current) echo "\${TEST_BRANCH:-prototype/first}" ;;
  rev-parse:HEAD) printf '%040d\\n' 1 ;;
esac
`,
        { mode: 0o755 },
      )
      process.env.PATH = `${workspace}:${originalPath}`
      const directory = path.join(workspace, "credentials")
      const client = createHubClient(
        { repositoryPath: workspace },
        {
          origin: `http://127.0.0.1:${server.address().port}`,
          directory,
        },
      )
      assert.equal((await client.status()).state, "disconnected")
      await assert.rejects(client.pair(), (error) => {
        assert.equal(error.statusCode, 404)
        assert.match(error.message, /could not find github\/replica for canvas pairing/)
        assert.ok(error.message.includes(`http://127.0.0.1:${server.address().port}`))
        assert.match(error.message, /local prototype session/)
        return true
      })
      missingRepository = false
      assert.equal((await client.pair()).userCode, "ABCD")
      assert.equal((await client.poll()).status, "approved")
      assert.ok(!calls.some(({ url }) => url.includes("device")))
      const callsBeforeInvalidRoute = calls.length
      await assert.rejects(
        client.request("//untrusted.example/api/canvas/prototype"),
        /Invalid Hub API route/,
      )
      await assert.rejects(client.request("/api/canvas/../private"), /Invalid Hub API route/)
      assert.equal(calls.length, callsBeforeInvalidRoute)
      await assert.rejects(
        client.request("/api/canvas/prototype?branch=prototype/first", {
          expectedTarget: {
            repository: "github/replica",
            branch: "prototype/stale",
          },
        }),
        { code: "stale_comment_target" },
      )
      assert.equal(calls.length, callsBeforeInvalidRoute)
      assert.equal((await client.status()).prototype.branch, "prototype/first")
      const credential = path.join(directory, (await readdir(directory))[0])
      assert.equal((await stat(credential)).mode & 0o077, 0)
      assert.match(await readFile(credential, "utf8"), /hub-secret/)

      process.env.TEST_BRANCH = "prototype/second"
      assert.equal((await client.status()).prototype.branch, "prototype/second")
      await client.disconnect()
      assert.deepEqual(await readdir(directory), [])
      assert.equal((await client.status()).state, "disconnected")
      assert.equal(calls.filter(({ auth }) => auth === "Bearer hub-secret").length, 3)
      assert.ok(!calls[0].auth)

      await client.pair()
      await client.poll()
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("No review invalidation arrived.")),
          2_000,
        )
        void client
          .subscribe(
            () => {
              clearTimeout(timeout)
              resolve()
            },
            (error) => {
              clearTimeout(timeout)
              reject(error)
            },
          )
          .catch((error) => {
            clearTimeout(timeout)
            reject(error)
          })
      })
    } finally {
      process.env.PATH = originalPath
      delete process.env.TEST_BRANCH
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
      await rm(workspace, { recursive: true, force: true })
    }
  })
})
