import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import { it } from "node:test"

import { createHubClient } from "./index.mjs"

it("accepts only a selected-Hub authorization URL and never exposes raw response fields", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "replica-fresh-authorization-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync("git", ["init", "-b", "prototype/new", root], {
    stdio: "ignore",
  })
  execFileSync("git", [
    "-C",
    root,
    "remote",
    "add",
    "origin",
    "https://github.com/github/prototype.git",
  ])
  let authorization
  const server = createServer((request, response) => {
    response.setHeader("X-Replica-Canvas-Version", "1")
    response.writeHead(403, { "Content-Type": "application/json" })
    response.end(
      JSON.stringify({
        code: "fresh_authorization_required",
        errors: ["Verify with GitHub"],
        authorization: {
          ...authorization,
          token: "must-not-enter-the-renderer",
        },
      }),
    )
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
      repository: "github/prototype",
      token: "fixture-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
    { mode: 0o600 },
  )
  const client = createHubClient({ repositoryPath: root }, { origin, directory })
  authorization = {
    url: `${origin}/authorization/12345678-1234-1234-1234-123456789abc`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  await assert.rejects(client.request("/api/canvas/connection"), (error) => {
    assert.equal(error.statusCode, 403)
    assert.equal(error.code, "fresh_authorization_required")
    assert.deepEqual(error.authorization, authorization)
    return true
  })
  for (const url of [
    "https://elsewhere.example/authorization/12345678-1234-1234-1234-123456789abc",
    `${origin}/repositories/1`,
    `${authorization.url}?token=secret`,
    `${authorization.url}#secret`,
  ]) {
    authorization = { ...authorization, url }
    await assert.rejects(client.request("/api/canvas/connection"), {
      statusCode: 502,
    })
  }
})
