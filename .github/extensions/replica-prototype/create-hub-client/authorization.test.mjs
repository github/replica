import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { it } from "node:test"
import { createHubClient } from "./index.mjs"

it("verifies repository authorization independently of branch discovery and never trusts a bare 404", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-authorization-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "-b", "prototype/new", root], { stdio: "ignore" })
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "https://github.com/github/prototype.git",
  ])
  let status = 200
  let repository = "github/prototype"
  let canPublish = false
  const server = createServer((request, response) => {
    response.setHeader("X-Replica-Canvas-Version", "1")
    if (request.url.startsWith("/api/canvas/prototype")) {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end('{"error":"Not found"}')
    } else {
      assert.equal(request.url, "/api/canvas/connection")
      assert.equal(request.headers.authorization, "Bearer fixture-token")
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ repository, canPublish }))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${server.address().port}`
  const directory = path.join(root, "credentials")
  await mkdir(directory, { mode: 0o700 })
  const key = createHash("sha256").update(`${origin}\ngithub/prototype`).digest("hex")
  await writeFile(
    path.join(directory, `${key}.json`),
    JSON.stringify({
      origin,
      repository,
      token: "fixture-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    { mode: 0o600 },
  )
  const client = createHubClient({ repositoryPath: root }, { origin, directory })
  const authorized = await client.status()
  assert.equal(authorized.state, "undiscovered")
  assert.equal(authorized.repositoryAuthorized, true)
  assert.equal(authorized.branch, "prototype/new")
  assert.equal(authorized.canPublish, false)
  canPublish = true
  assert.equal((await client.status()).canPublish, true)
  for (const code of [401, 403, 404, 500]) {
    status = code
    const denied = await client.status()
    assert.notEqual(denied.repositoryAuthorized, true)
    assert.notEqual(denied.state, "undiscovered")
  }
  status = 200
  repository = "github/another"
  assert.equal((await client.status()).state, "unavailable")
})
