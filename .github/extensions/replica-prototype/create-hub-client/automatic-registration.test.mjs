import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { it } from "node:test"

import { createHubClient } from "./index.mjs"

it("registers ready checkouts during polling, preserves metadata, and retries visible failures", async () => {
  const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(workspace, { recursive: true })
  function git(...args) {
    return execFileSync("git", ["-C", workspace, ...args], {
      encoding: "utf8",
    }).trim()
  }
  git("init", "-b", "prototype/welcome")
  git("remote", "add", "origin", "https://github.com/team/prototype.git")
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  )
  const commitSha = git("rev-parse", "HEAD")
  const ready = {
    id: 1,
    branch: "prototype/welcome",
    registered: false,
    published: false,
    canEdit: true,
    canRegister: true,
    name: null,
    description: null,
    build: { commitSha },
  }
  let prototype = { ...ready }
  let failure = 0
  let failureReason
  let missingReason
  let switchCheckout = false
  const registrations = []
  const server = createServer(async (request, response) => {
    response.setHeader("X-Replica-Canvas-Version", "1")
    let text = ""
    for await (const chunk of request) text += chunk
    response.setHeader("Content-Type", "application/json")
    if (request.url === "/api/canvas/connection") {
      response.end(JSON.stringify({ repository: "team/prototype" }))
      return
    }
    if (request.method === "GET" && missingReason !== undefined) {
      response.writeHead(404)
      response.end(
        JSON.stringify({
          error: "Branch unavailable.",
          registrationReason: missingReason,
        }),
      )
      return
    }
    if (request.method === "PATCH") {
      registrations.push(JSON.parse(text))
      assert.equal(request.headers["x-replica-canvas-activity"], undefined)
      if (failure) {
        response.writeHead(failure)
        response.end(
          JSON.stringify({
            error: "Registration temporarily unavailable.",
            registrationReason: failureReason,
          }),
        )
        return
      }
      prototype = {
        ...prototype,
        registered: true,
        published: true,
        name: prototype.name || prototype.branch,
      }
    } else if (switchCheckout) {
      switchCheckout = false
      git("switch", "-q", "-c", "prototype/second")
    }
    response.end(JSON.stringify(prototype))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const directory = path.join(workspace, "credentials")
    await mkdir(directory, { mode: 0o700 })
    const key = createHash("sha256").update(`${origin}\nteam/prototype`).digest("hex")
    await writeFile(
      path.join(directory, `${key}.json`),
      JSON.stringify({
        origin,
        repository: "team/prototype",
        token: "test-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      { mode: 0o600 },
    )
    const client = createHubClient({ repositoryPath: workspace }, { origin, directory })

    for (const overrides of [
      { registered: true },
      { canEdit: false },
      { canRegister: false },
      { branch: "prototype/another" },
      { build: null },
      { build: { commitSha: "b".repeat(40) } },
    ]) {
      prototype = { ...ready, ...overrides }
      assert.equal((await client.status()).state, "connected")
      assert.equal(registrations.length, 0)
    }

    prototype = { ...ready }
    for (const status of [503, 404, 409, 422]) {
      failure = status
      const rejected = await client.status()
      assert.equal(rejected.state, "connected")
      assert.deepEqual(rejected.prototype, ready)
      assert.match(rejected.registrationError, /Automatic prototype registration failed/)
      assert.match(rejected.registrationError, /Registration temporarily unavailable/)
      assert.equal(prototype.registered, false)
    }
    for (const [status, state] of [
      [401, "disconnected"],
      [403, "denied"],
    ]) {
      failure = status
      const rejected = await client.status()
      assert.equal(rejected.state, state)
      assert.equal(rejected.prototype, undefined)
      assert.equal(rejected.registrationError, undefined)
    }
    failure = 403
    failureReason = "write_access_required"
    const ineligible = await client.status()
    assert.equal(ineligible.state, "connected")
    assert.equal(ineligible.registrationReason, "write_access_required")
    assert.deepEqual(ineligible.prototype, ready)
    assert.match(ineligible.registrationError, /Registration temporarily unavailable/)
    failureReason = undefined
    failure = 0
    const published = await client.status()
    assert.equal(published.state, "connected")
    assert.equal(published.prototype.published, true)
    assert.equal(published.prototype.name, "prototype/welcome")
    assert.equal(published.registrationError, undefined)
    assert.equal(registrations.length, 8)
    for (const registration of registrations)
      assert.deepEqual(registration, {
        branch: "prototype/welcome",
        automatic: true,
        commit_sha: commitSha,
      })
    prototype.name = "Edited title"
    await client.status()
    assert.equal(registrations.length, 8)
    assert.equal(prototype.name, "Edited title")

    prototype = { ...ready }
    switchCheckout = true
    await client.status()
    assert.equal(registrations.length, 8)
    prototype = { ...ready, branch: "prototype/second" }
    const second = await client.status()
    assert.equal(second.state, "connected", second.message)
    assert.equal(second.prototype.published, true)
    assert.equal(registrations[8].branch, "prototype/second")

    for (const reason of ["branch_not_reviewable", "future_registration_rule"]) {
      missingReason = reason
      const missing = await client.status()
      assert.equal(missing.state, "undiscovered")
      assert.equal(missing.repositoryAuthorized, true)
      assert.equal(missing.registrationReason, reason)
      assert.equal(registrations.length, 9)
    }
    missingReason = 42
    const invalid = await client.status()
    assert.equal(invalid.state, "unavailable")
    assert.match(invalid.message, /invalid registration reason/)
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(workspace, { recursive: true, force: true })
  }
})
