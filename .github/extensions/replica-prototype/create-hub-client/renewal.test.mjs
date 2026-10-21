import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import { it } from "node:test"

import { createHubClient } from "./index.mjs"

it("shares approval, serializes refresh, recovers lost responses and stops after revocation", async () => {
  const workspace = path.join(process.cwd(), "storage/replica-extension-tests", randomUUID())
  await mkdir(workspace, { recursive: true })
  execFileSync("git", ["init", "-b", "prototype/new", workspace], {
    stdio: "ignore",
  })
  execFileSync("git", [
    "-C",
    workspace,
    "remote",
    "add",
    "origin",
    "git@github.com:team/prototype.git",
  ])
  const refreshToken = `rr_${"r".repeat(43)}`
  const state = {
    pairs: 0,
    polls: 0,
    renewals: 0,
    activities: 0,
    access: "first",
    revoked: false,
    loseRefresh: false,
    losePoll: true,
    redirect: false,
    redirected: 0,
  }
  const server = createServer(async (request, response) => {
    response.setHeader("X-Replica-Canvas-Version", "1")
    let text = ""
    for await (const chunk of request) text += chunk
    assert.ok(!request.url.includes(refreshToken))
    const body = text ? JSON.parse(text) : {}
    if (request.url === "/redirect-target") state.redirected++
    if (state.redirect) {
      response.writeHead(302, { Location: "/redirect-target" })
      response.end()
      return
    }
    function json(value, status = 200) {
      response.writeHead(status, { "Content-Type": "application/json" })
      response.end(JSON.stringify(value))
    }
    function credentials() {
      return {
        accessToken: state.access,
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        connectionId: 1,
        repository: "team/prototype",
      }
    }
    if (request.url === "/api/canvas/pairings") {
      state.pairs++
      assert.equal(body.renewable, true)
      return json({
        deviceCode: "device",
        userCode: "CODE",
        refreshToken,
        verificationUrl: `http://127.0.0.1:${server.address().port}/canvas/pair/CODE`,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      })
    }
    if (request.url === "/api/canvas/pairings/token") {
      state.polls++
      if (state.losePoll) {
        state.losePoll = false
        return response.destroy()
      }
      return json({ status: "expired" })
    }
    if (request.url === "/api/canvas/connection/renewal") {
      assert.equal(body.refresh_token, refreshToken)
      if (request.method === "DELETE") {
        state.revoked = true
        return json({})
      }
      state.renewals++
      if (state.revoked) return json({ error: "Revoked." }, 401)
      state.access = `renewed-${state.renewals}`
      if (state.loseRefresh) {
        state.loseRefresh = false
        return response.destroy()
      }
      return json(credentials())
    }
    if (state.revoked || request.headers.authorization !== `Bearer ${state.access}`)
      return json({ error: "Expired." }, 401)
    if (request.url === "/api/canvas/connection" && request.method === "PATCH") {
      state.activities++
      return json({})
    }
    if (request.url === "/api/canvas/connection" && request.method === "GET")
      return json({ repository: "team/prototype" })
    return json({ error: "Branch not discovered." }, 404)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const directory = path.join(workspace, "credentials")
  const file = path.join(
    directory,
    `${createHash("sha256").update(`${origin}\nteam/prototype`).digest("hex")}.json`,
  )
  async function updateFile(file, changes) {
    const previous = JSON.parse(await readFile(file, "utf8"))
    await writeFile(file, JSON.stringify({ ...previous, ...changes }), {
      mode: 0o600,
    })
  }
  function client() {
    return createHubClient(
      {
        repositoryPath: workspace,
        target: { repository: "spoofed/repository" },
      },
      { origin, directory },
    )
  }
  try {
    const [first, second] = [client(), client()]
    const pairings = await Promise.all([first.pair(), second.pair(), client().pair()])
    assert.equal(state.pairs, 1)
    assert.deepEqual(pairings[0], pairings[1])
    assert.ok(!JSON.stringify(pairings).includes(refreshToken))
    await assert.rejects(first.poll())
    await updateFile(`${file}.pairing`, { retryAfter: 0, nextPollAt: 0 })
    assert.equal((await second.poll()).status, "approved")
    assert.equal((await first.status()).state, "undiscovered")
    assert.equal(state.pairs, 1)
    assert.equal(state.renewals, 1)
    assert.equal((await stat(file)).mode & 0o077, 0)
    assert.equal((await stat(directory)).mode & 0o077, 0)
    assert.equal(JSON.parse(await readFile(file, "utf8")).refreshToken, refreshToken)
    state.redirect = true
    assert.equal((await first.status()).state, "unavailable")
    assert.equal(state.redirected, 0)
    state.redirect = false

    await updateFile(file, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    const statuses = await Promise.all(Array.from({ length: 8 }, () => client().status()))
    assert.ok(
      statuses.every(({ state }) => state === "undiscovered"),
      JSON.stringify(statuses),
    )
    assert.equal(state.renewals, 2)
    assert.equal(state.activities, 0)
    await second.activity()
    assert.equal(state.activities, 1)

    state.loseRefresh = true
    await updateFile(file, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    assert.equal((await first.status()).state, "unavailable")
    assert.equal((await second.status()).state, "unavailable")
    assert.equal(state.renewals, 3)
    await updateFile(file, { retryAfter: 0 })
    assert.equal((await client().status()).state, "undiscovered")
    assert.equal(state.renewals, 4)
    assert.equal(state.pairs, 1)
    state.revoked = true
    assert.equal((await first.status()).state, "disconnected")
    assert.equal(state.renewals, 5)
    assert.equal((await second.status()).state, "disconnected")
    assert.equal(state.renewals, 5)
    state.revoked = false
    const afterAnotherSignIn = await client().status()
    assert.equal(afterAnotherSignIn.state, "disconnected")
    assert.match(afterAnotherSignIn.message, /Approve a new connection/)
    assert.equal(state.renewals, 5)
    assert.equal(state.pairs, 1)
    await first.disconnect()
    await assert.rejects(readFile(file), { code: "ENOENT" })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(workspace, { recursive: true, force: true })
  }
})
