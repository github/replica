import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { test } from "node:test"

import { createTaskClient } from "./task-client.mjs"

const origin = "https://hub.example.com"
const deviceCode = "d".repeat(43)
const accessToken = `rt_${"a".repeat(43)}`
const scope = { repository: "github/prototype", branch: "prototype/welcome" }

async function fixture(t, fetchImpl) {
  const directory = await mkdtemp(path.join(process.cwd(), ".task-client-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stateDirectory = path.join(directory, "private")
  const checkout = path.join(directory, "checkout")
  await mkdir(checkout)
  return {
    stateDirectory,
    checkout,
    client: createTaskClient({ origin, stateDirectory, checkout, fetchImpl }),
  }
}

function response(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), { status })
}

function approval() {
  return {
    deviceCode,
    userCode: "ABCDEF1234",
    verificationUrl: `${origin}/tasks/approve/ABCDEF1234`,
    expiresAt: "2026-11-10T10:10:00Z",
  }
}

test("keeps proofs private and returns only public connection scope", async (t) => {
  const calls = []
  const { client, stateDirectory } = await fixture(t, async (url, options) => {
    calls.push({ url: String(url), options })
    assert.equal(options.redirect, "error")
    if (url.pathname === "/api/tasks/connections") return response(approval(), 201)
    if (url.pathname === "/api/tasks/connections/token") {
      assert.equal(JSON.parse(options.body).device_code, deviceCode)
      return response({
        status: "approved",
        connectionId: 7,
        repositoryId: 2001,
        ...scope,
        accessToken,
        approvedAt: "2026-11-10T10:01:00Z",
        expiresAt: "2026-11-11T10:01:00Z",
      })
    }
    assert.equal(options.headers.Authorization, `Bearer ${accessToken}`)
    if (options.method === "DELETE") return response(null, 204)
    return response({ id: 7, repositoryId: 2001, ...scope, expiresAt: "2026-11-11T10:01:00Z" })
  })

  const started = await client.start(scope)
  assert.equal(started.verificationUrl, approval().verificationUrl)
  assert.ok(!JSON.stringify(started).includes(deviceCode))
  assert.equal((await lstat(stateDirectory)).mode & 0o077, 0)
  const statePath = path.join(stateDirectory, "connection.json")
  assert.equal((await lstat(statePath)).mode & 0o077, 0)
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).deviceCode, deviceCode)

  const connected = await client.poll()
  assert.equal(connected.connectionId, 7)
  assert.ok(!JSON.stringify(connected).includes(accessToken))
  const privateState = JSON.parse(await readFile(statePath, "utf8"))
  assert.equal(privateState.accessToken, accessToken)
  assert.equal(privateState.deviceCode, undefined)
  assert.deepEqual(await client.poll(), connected)
  assert.equal(calls.filter(({ url }) => url.endsWith("/token")).length, 1)
  assert.equal((await client.status()).expiresAt, connected.expiresAt)
  await assert.rejects(client.start(scope), /already has private/)
  assert.deepEqual(await client.disconnect(), { status: "disconnected" })
  await assert.rejects(lstat(statePath), { code: "ENOENT" })
})

test("rejects another origin, scope or extended lifetime", async (t) => {
  const { client } = await fixture(t, async () =>
    response({ ...approval(), verificationUrl: "https://attacker.example/approve" }),
  )
  await assert.rejects(client.start(scope), /invalid approval request/)

  for (const invalid of [
    { branch: "prototype/other" },
    { repository: "github/other" },
    { expiresAt: "2026-11-12T10:01:00Z" },
  ]) {
    const { client: invalidClient } = await fixture(t, async (url) =>
      url.pathname.endsWith("/token")
        ? response({
            status: "approved",
            connectionId: 7,
            repositoryId: 2001,
            ...scope,
            accessToken,
            approvedAt: "2026-11-10T10:01:00Z",
            expiresAt: "2026-11-11T10:01:00Z",
            ...invalid,
          })
        : response(approval(), 201),
    )
    await invalidClient.start(scope)
    await assert.rejects(invalidClient.poll(), /invalid task credential/)
  }
})

test("adopts canonical repository casing after consuming the one-use approval", async (t) => {
  const requested = { repository: "GitHub/Prototype", branch: scope.branch }
  const { client, stateDirectory } = await fixture(t, async (url) => {
    if (url.pathname === "/api/tasks/connections") return response(approval(), 201)
    if (url.pathname === "/api/tasks/connections/token") {
      return response({
        status: "approved",
        connectionId: 7,
        repositoryId: 2001,
        ...scope,
        accessToken,
        approvedAt: "2026-11-10T10:01:00Z",
        expiresAt: "2026-11-11T10:01:00Z",
      })
    }
    return response({
      id: 7,
      repositoryId: 2001,
      ...scope,
      expiresAt: "2026-11-11T10:01:00Z",
    })
  })

  await client.start(requested)
  const connected = await client.poll()

  assert.equal(connected.repository, scope.repository)
  assert.equal(
    JSON.parse(await readFile(path.join(stateDirectory, "connection.json"), "utf8")).repository,
    scope.repository,
  )
  assert.equal((await client.status()).repository, connected.repository)
})

test("sanitizes failures and preserves saved connection state", async (t) => {
  let status = 201
  const { client, stateDirectory } = await fixture(t, async () =>
    status === 201
      ? response(approval(), 201)
      : response({ accessToken, error: deviceCode }, status),
  )
  await client.start(scope)
  status = 503
  await assert.rejects(client.poll(), { message: "Hub rejected the request (HTTP 503)." })
  const stored = JSON.parse(await readFile(path.join(stateDirectory, "connection.json"), "utf8"))
  assert.equal(stored.deviceCode, deviceCode)
  await assert.rejects(client.disconnect(), /Deny the pending request/)
  await writeFile(
    path.join(stateDirectory, "connection.json"),
    `{"accessToken":"${accessToken}" invalid`,
  )
  await assert.rejects(client.poll(), {
    message: "Task state is unreadable. Revoke the connection in Hub before starting again.",
  })
})

test("rechecks saved approval instead of reporting revoked credentials as approved", async (t) => {
  const { client } = await fixture(t, async (url) => {
    if (url.pathname === "/api/tasks/connections") return response(approval(), 201)
    if (url.pathname.endsWith("/token")) {
      return response({
        status: "approved",
        connectionId: 7,
        repositoryId: 2001,
        ...scope,
        accessToken,
        approvedAt: "2026-11-10T10:01:00Z",
        expiresAt: "2026-11-11T10:01:00Z",
      })
    }
    return response({ accessToken }, 401)
  })
  await client.start(scope)
  await client.poll()
  await assert.rejects(client.poll(), { message: "Hub rejected the request (HTTP 401)." })
  await assert.rejects(client.status(), { message: "Hub rejected the request (HTTP 401)." })
})

test("disconnect clears a definitively unauthorized bearer so the task can be reused", async (t) => {
  let starts = 0
  const { client, stateDirectory } = await fixture(t, async (url, options) => {
    if (url.pathname === "/api/tasks/connections") {
      starts++
      return response(approval(), 201)
    }
    if (url.pathname.endsWith("/token")) {
      return response({
        status: "approved",
        connectionId: 7,
        repositoryId: 2001,
        ...scope,
        accessToken,
        approvedAt: "2026-11-10T10:01:00Z",
        expiresAt: "2026-11-11T10:01:00Z",
      })
    }
    assert.equal(options.method, "DELETE")
    return response({}, 401)
  })
  await client.start(scope)
  await client.poll()
  await client.disconnect()
  await assert.rejects(lstat(path.join(stateDirectory, "connection.json")), { code: "ENOENT" })
  await client.start(scope)
  assert.equal(starts, 2)
})

test("disconnect preserves bearer state on server and transport failures", async (t) => {
  for (const failure of ["server", "transport"]) {
    const { client, stateDirectory } = await fixture(t, async (url) => {
      if (url.pathname === "/api/tasks/connections") return response(approval(), 201)
      if (url.pathname.endsWith("/token")) {
        return response({
          status: "approved",
          connectionId: 7,
          repositoryId: 2001,
          ...scope,
          accessToken,
          approvedAt: "2026-11-10T10:01:00Z",
          expiresAt: "2026-11-11T10:01:00Z",
        })
      }
      if (failure === "transport") throw new Error("offline")
      return response({}, 503)
    })
    await client.start(scope)
    await client.poll()
    const statePath = path.join(stateDirectory, "connection.json")
    const before = await readFile(statePath, "utf8")
    await assert.rejects(client.disconnect())
    assert.equal(await readFile(statePath, "utf8"), before)
    await assert.rejects(client.start(scope), /already has private/)
  }
})

test("disconnect preserves pending and expired proofs when exchange outcome is uncertain", async (t) => {
  for (const status of ["pending", "expired"]) {
    const { client, stateDirectory } = await fixture(t, async (url) =>
      url.pathname.endsWith("/token") ? response({ status }) : response(approval(), 201),
    )
    await client.start(scope)
    assert.equal((await client.poll()).status, status)
    const statePath = path.join(stateDirectory, "connection.json")
    const before = await readFile(statePath, "utf8")
    await assert.rejects(client.disconnect(), /Deny the pending request/)
    assert.equal(await readFile(statePath, "utf8"), before)
    await assert.rejects(client.start(scope), /already has private/)
  }
})

test("CLI rejects private state inside the enclosing checkout from a subdirectory", async (t) => {
  const { checkout } = await fixture(t)
  const init = spawnSync("git", ["init", "--quiet", checkout], { encoding: "utf8" })
  assert.equal(init.status, 0, init.stderr)
  const subdirectory = path.join(checkout, "project")
  const home = path.join(checkout, "fake-home")
  const stateDirectory = path.join(home, ".config", "replica", "tasks", "dummy")
  await mkdir(subdirectory)
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
  await writeFile(
    path.join(stateDirectory, "connection.json"),
    JSON.stringify({ origin, ...scope, deviceCode }),
    { mode: 0o600 },
  )

  const cli = spawnSync(
    process.execPath,
    [path.resolve("script/task-client.mjs"), "status", origin, "dummy"],
    { cwd: subdirectory, env: { ...process.env, HOME: home }, encoding: "utf8" },
  )
  assert.equal(cli.status, 1)
  assert.match(cli.stderr, /outside the repository checkout/)
})

test("refuses readable or symbolic-link state and noncanonical origins", async (t) => {
  const { client, stateDirectory, checkout } = await fixture(t, async () =>
    response(approval(), 201),
  )
  await client.start(scope)
  await chmod(path.join(stateDirectory, "connection.json"), 0o644)
  await assert.rejects(client.poll(), /owner-only/)
  await chmod(stateDirectory, 0o755)
  await assert.rejects(client.poll(), /owner-only/)
  await chmod(stateDirectory, 0o700)
  const linked = `${stateDirectory}-link`
  await symlink(stateDirectory, linked)
  const linkedClient = createTaskClient({
    origin,
    stateDirectory: linked,
    checkout,
  })
  await assert.rejects(linkedClient.poll(), /without symbolic links/)
  const checkoutClient = createTaskClient({
    origin,
    stateDirectory: `${path.dirname(stateDirectory)}/unused/../private`,
    checkout: stateDirectory,
  })
  await assert.rejects(checkoutClient.poll(), /outside the repository checkout/)
  for (const invalidOrigin of [
    "http://hub.example.com",
    `${origin}/path`,
    "https://user:secret@hub.example.com",
    "https://user:secret@[invalid",
  ]) {
    assert.throws(() => createTaskClient({ origin: invalidOrigin }), /canonical Hub HTTPS origin/)
  }
})

test("sanitizes malformed envelopes and streamed transport errors", async (t) => {
  for (const body of [null, [], "invalid", "x".repeat(128 * 1024 + 1)]) {
    const { client } = await fixture(t, async () => response(body, 200))
    await assert.rejects(client.start(scope), /Hub (returned an invalid|task response)/)
  }
  const { client } = await fixture(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error(`transport received ${accessToken}`))
          },
        }),
      ),
  )
  await assert.rejects(client.start(scope), {
    message: "Hub task response could not be read within the client limit.",
  })
})

async function connectedFixture(t, publicationResponse) {
  const calls = []
  const result = await fixture(t, async (url, options) => {
    calls.push({ path: url.pathname, ...options })
    if (url.pathname === "/api/tasks/connections") return response(approval(), 201)
    if (url.pathname === "/api/tasks/connections/token") {
      return response({
        status: "approved",
        connectionId: 7,
        repositoryId: 2001,
        ...scope,
        accessToken,
        approvedAt: "2026-11-10T10:01:00Z",
        expiresAt: "2026-11-11T10:01:00Z",
      })
    }
    assert.equal(options.headers.Authorization, ["Bearer", accessToken].join(" "))
    assert.equal(options.redirect, "error")
    return response(publicationResponse)
  })
  await result.client.start(scope)
  await result.client.poll()
  return { ...result, calls }
}

function publication(overrides = {}) {
  return {
    status: "ready",
    phase: "registration",
    repositoryGitHubId: 2001,
    prototypeId: 12,
    branch: scope.branch,
    commitSha: "b".repeat(40),
    registered: true,
    registration: "created",
    buildId: 21,
    buildNumber: 3,
    runId: 41,
    runAttempt: 1,
    artifactId: 51,
    url: `${origin}/repositories/2001/prototypes/12?build=3`,
    ...overrides,
  }
}

test("lookup reports only the approved branch target and never registers it", async (t) => {
  for (const prototypeId of [null, 12]) {
    const target = { repositoryGitHubId: 2001, branch: scope.branch, prototypeId }
    const { client, calls } = await connectedFixture(t, {
      ...target,
      accessToken,
      unrelated: "private-server-data",
    })

    assert.deepEqual(await client.lookup(), target)
    const lookup = calls.at(-1)
    assert.equal(lookup.path, "/api/tasks/prototype")
    assert.equal(lookup.method, "GET")
    assert.equal(lookup.body, undefined)
    assert.equal(calls.filter(({ path }) => path.endsWith("/registration")).length, 0)
  }

  for (const invalid of [
    { branch: "prototype/another" },
    { repositoryGitHubId: 2002 },
    { prototypeId: -1 },
  ]) {
    const { client } = await connectedFixture(t, {
      repositoryGitHubId: 2001,
      branch: scope.branch,
      prototypeId: 12,
      ...invalid,
    })
    await assert.rejects(client.lookup(), /invalid prototype target/)
  }
})

test("register sends one explicit target and commit and returns only pinned public evidence", async (t) => {
  for (const registration of ["created", "existing"]) {
    const expected = publication({ registration })
    const { client, stateDirectory, calls } = await connectedFixture(t, {
      ...expected,
      accessToken,
      arbitrary: { secret: deviceCode },
    })

    const result = await client.register({ prototypeId: 12, commitSha: expected.commitSha })

    assert.deepEqual(result, expected)
    const mutations = calls.filter(({ path }) => path === "/api/tasks/prototype/registration")
    assert.equal(mutations.length, 1)
    assert.equal(mutations[0].method, "PUT")
    assert.deepEqual(JSON.parse(mutations[0].body), {
      prototype_id: 12,
      commit_sha: expected.commitSha,
    })
    assert.equal(
      calls.some(({ path }) => path === "/api/tasks/prototype"),
      false,
    )
    const saved = JSON.parse(await readFile(path.join(stateDirectory, "connection.json"), "utf8"))
    assert.equal(saved.accessToken, accessToken)
    assert.equal((await lstat(path.join(stateDirectory, "connection.json"))).mode & 0o077, 0)
  }
})

test("register rejects invalid targets and commit SHAs before any mutation", async (t) => {
  const { client, calls } = await connectedFixture(t, publication())
  for (const invalid of [
    { prototypeId: null, commitSha: "b".repeat(40) },
    { prototypeId: 0, commitSha: "b".repeat(40) },
    { prototypeId: "12", commitSha: "b".repeat(40) },
    { prototypeId: Number.MAX_SAFE_INTEGER + 1, commitSha: "b".repeat(40) },
    { prototypeId: 12, commitSha: "main" },
    { prototypeId: 12, commitSha: "b".repeat(39) },
  ]) {
    await assert.rejects(async () => client.register(invalid))
  }
  assert.equal(calls.filter(({ path }) => path.endsWith("/registration")).length, 0)
})

test("register never reports a pending or failed import as ready", async (t) => {
  for (const [status, phase] of [
    ["pending", "discovery"],
    ["pending", "import"],
    ["failed", "workflow"],
    ["superseded", "registration"],
    ["blocked", "registration"],
  ]) {
    const envelope = {
      status,
      phase,
      reason: "build_not_imported",
      repositoryGitHubId: 2001,
      prototypeId: 12,
      branch: scope.branch,
      commitSha: "b".repeat(40),
      registered: false,
    }
    const { client } = await connectedFixture(t, {
      ...envelope,
      accessToken,
      arbitrary: deviceCode,
    })
    assert.deepEqual(
      await client.register({ prototypeId: 12, commitSha: envelope.commitSha }),
      envelope,
    )
  }
})

test("register rejects malformed status and failure envelopes instead of echoing arbitrary reasons", async (t) => {
  for (const invalid of [
    { status: "unknown" },
    { phase: "unknown" },
    { reason: undefined },
    { reason: "" },
    { reason: "Server error with private details." },
    { reason: "a".repeat(81) },
  ]) {
    const { client } = await connectedFixture(
      t,
      publication({
        status: "pending",
        phase: "import",
        reason: "build_not_imported",
        ...invalid,
      }),
    )
    await assert.rejects(async () =>
      client.register({ prototypeId: 12, commitSha: "b".repeat(40) }),
    )
  }
})

test("register rejects mismatched scope, target, commit and unpinned ready evidence", async (t) => {
  for (const invalid of [
    { branch: "prototype/another" },
    { repositoryGitHubId: 2002 },
    { prototypeId: 13 },
    { commitSha: "c".repeat(40) },
    { registered: false },
    { registration: undefined },
    { artifactId: undefined },
    { buildNumber: 0 },
    { runId: "41" },
    { runAttempt: -1 },
    { url: "https://attacker.example/repositories/2001/prototypes/12?build=3" },
    { url: `${origin}/repositories/2001/prototypes/13?build=3` },
    { url: `${origin}/repositories/2001/prototypes/12` },
    { url: `${origin}/repositories/2001/prototypes/12?build=4` },
    { url: `${origin}/repositories/2001/prototypes/12?build=3#untrusted` },
  ]) {
    const { client, calls } = await connectedFixture(t, publication(invalid))
    await assert.rejects(async () =>
      client.register({ prototypeId: 12, commitSha: "b".repeat(40) }),
    )
    assert.equal(calls.filter(({ path }) => path.endsWith("/registration")).length, 1)
  }
})
