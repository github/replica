import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createConnection, createServer } from "node:net"
import { after, afterEach, it } from "node:test"
import { fileURLToPath } from "node:url"
import pg from "pg"
import {
  agent,
  designer,
  memoryProviderConformance,
  weekOneLog,
  weekTwoLog,
} from "../conformance/index.mjs"
import { main } from "../src/cli.mjs"
import { openProvider } from "../src/config.mjs"
import { migratePostgres, postgresPool } from "../src/providers/postgres-database.mjs"
import { createPostgresMemoryProvider } from "../src/providers/postgres.mjs"
import { createLearningStore } from "../src/store.mjs"
import { validateRecord } from "../src/validate.mjs"

const baseUrl = process.env.REPLICA_LEARNING_TEST_DATABASE_URL
if (!baseUrl) throw new Error("Set REPLICA_LEARNING_TEST_DATABASE_URL to a disposable database.")

const admin = new pg.Pool({ connectionString: baseUrl })
const databases = []
const roles = []
const providers = []

async function database({ migrate = true } = {}) {
  const name = `replica_test_${randomBytes(12).toString("hex")}`
  await admin.query(`create database "${name}"`)
  databases.push(name)
  const url = new URL(baseUrl)
  url.pathname = `/${name}`
  if (migrate) await migratePostgres({ connectionString: url.href })
  return url.href
}

function provider(connectionString) {
  const result = createPostgresMemoryProvider({ connectionString })
  providers.push(result)
  return result
}

afterEach(async () => {
  const errors = []
  for (const opened of providers.splice(0)) {
    try {
      await opened.close()
    } catch (error) {
      errors.push(error)
    }
  }
  for (const name of databases.splice(0)) {
    try {
      await admin.query(`drop database "${name}"`)
    } catch (error) {
      errors.push(error)
    }
  }
  for (const name of roles.splice(0)) {
    try {
      await admin.query(`drop role "${name}"`)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, "Could not remove test resources.")
})
after(async () => admin.end())

memoryProviderConformance({
  name: "PostgreSQL provider",
  createProvider: async () => provider(await database()),
})

it("migrates only with the migration URL and lets a limited runtime login use the store", async () => {
  const url = await database({ migrate: false })
  const role = `replica_test_${randomBytes(12).toString("hex")}`
  await admin.query(`create role "${role}" login password 'replica-test-password'`)
  roles.push(role)
  const runtimeUrl = new URL(url)
  runtimeUrl.searchParams.delete("user")
  runtimeUrl.searchParams.delete("password")
  runtimeUrl.username = role
  runtimeUrl.password = "replica-test-password"
  const runtime = provider(runtimeUrl.href)
  assert.equal((await runtime.health()).ok, false)

  async function cli(env) {
    let stdout = ""
    let stderr = ""
    const code = await main(["migrate", "--json"], {
      env,
      stdout: { write: (text) => (stdout += text) },
      stderr: { write: (text) => (stderr += text) },
    })
    return { code, stdout, stderr }
  }
  const missing = await cli({ REPLICA_LEARNING_DATABASE_URL: url })
  assert.notEqual(missing.code, 0)
  const migrationEnv = { REPLICA_LEARNING_MIGRATION_DATABASE_URL: url }
  const results = await Promise.all([cli(migrationEnv), cli(migrationEnv)])
  assert.deepEqual(
    results.map((result) => result.code),
    [0, 0],
  )
  assert.deepEqual(JSON.parse(results[0].stdout), JSON.parse(results[1].stdout))

  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    const ledger = await db.query(
      "select version, checksum from replica_learning.schema_migrations",
    )
    assert.ok(ledger.rowCount > 0)
    assert.equal(
      JSON.parse(results[0].stdout).version,
      Math.max(...ledger.rows.map((row) => row.version)),
    )
    await db.query(`grant usage on schema replica_learning to "${role}"`)
    await db.query(`grant select on replica_learning.schema_migrations to "${role}"`)
    await db.query(`grant select, insert, update on replica_learning.records to "${role}"`)
    await db.query(`grant select, insert on replica_learning.memory_versions to "${role}"`)
    await db.query(`grant usage on all sequences in schema replica_learning to "${role}"`)
    const restricted = new pg.Client({ connectionString: runtimeUrl.href })
    await restricted.connect()
    try {
      await assert.rejects(restricted.query("create table replica_learning.forbidden (id int)"), {
        code: "42501",
      })
      await assert.rejects(
        restricted.query("update replica_learning.memory_versions set digest = 'forbidden'"),
        { code: "42501" },
      )
    } finally {
      await restricted.end()
    }
    const record = { id: "grant_runtime", digest: "sha256:runtime", scope: { repository: "a" } }
    await runtime.appendRecords("grants", [record])
    assert.deepEqual(await runtime.readRecords("grants", { scope: record.scope }), [record])
    const memory = {
      id: "memory_runtime",
      version: 1,
      digest: "sha256:memory",
      scope: record.scope,
    }
    await runtime.appendMemoryVersion(memory, { expectedPreviousDigest: null })
    assert.deepEqual(await runtime.readMemoryVersions({ scope: record.scope }), [memory])
    const event = {
      id: "event_runtime",
      digest: "sha256:event",
      scope: record.scope,
      type: "human_comment",
      payload: { commentId: 123, body: "Private review." },
    }
    await runtime.appendRecords("events", [event])
    const { payload, ...withoutPayload } = event
    assert.ok(payload)
    const redacted = {
      ...withoutPayload,
      redaction: { commentId: 123, reason: "Requested." },
    }
    assert.deepEqual(await runtime.redactRecord("events", redacted), { redacted: true })
    assert.deepEqual(await runtime.readRecords("events", { scope: record.scope }), [redacted])
  } finally {
    await db.end()
  }
})

it("refuses a changed migration ledger rather than using or repairing it", async () => {
  const url = await database()
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    await db.query("update replica_learning.schema_migrations set checksum = 'changed'")
    const opened = provider(url)
    assert.equal((await opened.health()).ok, false)
    await assert.rejects(opened.readRecords("grants", { scope: { repository: "a" } }), {
      code: "storage_corrupt",
    })
    await assert.rejects(migratePostgres({ connectionString: url }), { code: "storage_corrupt" })
    const { rows } = await db.query("select checksum from replica_learning.schema_migrations")
    assert.deepEqual(
      rows.map((row) => row.checksum),
      ["changed"],
    )
  } finally {
    await db.end()
  }
})

it("serializes concurrent migrations when the database defaults to repeatable read", async () => {
  const url = await database({ migrate: false })
  const name = new URL(url).pathname.slice(1)
  await admin.query(
    `alter database "${name}" set default_transaction_isolation = 'repeatable read'`,
  )
  const holder = new pg.Client({ connectionString: url })
  await holder.connect()
  let migrations
  let results
  try {
    await holder.query("begin")
    await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "replica_learning.schema_migrations",
    ])
    migrations = [
      migratePostgres({ connectionString: url }),
      migratePostgres({ connectionString: url }),
    ]
    for (const migration of migrations) migration.catch(() => {})
    const deadline = Date.now() + 5000
    while (true) {
      await holder.query("select pg_stat_clear_snapshot()")
      const { rows } = await holder.query(
        "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event = 'advisory'",
      )
      if (rows[0].count >= 2) break
      assert.ok(Date.now() < deadline, "Both migrations must wait for the first migration.")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    await holder.query("rollback")
    results = await Promise.allSettled(migrations ?? [])
    await holder.end()
  }
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  )
  assert.deepEqual(results[0].value, results[1].value)
})

it("uses the runtime URL from the environment without exposing its credentials", async () => {
  const url = await database()
  const environment = {
    config: { memory: { provider: "postgres", connectionString: url } },
    env: {},
  }
  await assert.rejects(openProvider(environment), { code: "invalid_input" })
  environment.env.REPLICA_LEARNING_DATABASE_URL = url
  const { provider: opened } = await openProvider(environment)
  providers.push(opened)
  assert.equal((await opened.health()).ok, true)
  const publicDetails = JSON.stringify({
    manifest: opened.manifest(),
    health: await opened.health(),
  })
  assert.equal(publicDetails.includes(url), false)
  const parsed = new URL(url)
  if (parsed.password)
    assert.equal(publicDetails.includes(`${parsed.username}:${parsed.password}`), false)

  parsed.hostname = "127.0.0.1"
  parsed.port = "1"
  parsed.username = "test-user"
  parsed.password = "never-show-these-credentials"
  parsed.searchParams.delete("host")
  parsed.searchParams.delete("port")
  parsed.searchParams.delete("user")
  parsed.searchParams.delete("password")
  const unavailable = provider(parsed.href)
  assert.equal((await unavailable.health()).ok, false)
  await assert.rejects(
    unavailable.readRecords("grants", { scope: { repository: "a" } }),
    (error) => {
      assert.equal(error.code, "unavailable")
      assert.doesNotMatch(error.message, /never-show-these-credentials/)
      return true
    },
  )
})

it("requires verified TLS for remote PostgreSQL but permits plaintext loopback", async () => {
  const url = new URL(await database())
  url.searchParams.set("sslmode", "disable")
  const local = provider(url.href)
  const record = { id: "local", digest: "sha256:local", scope: { repository: "a" } }
  await local.appendRecords("grants", [record])
  assert.deepEqual(await local.readRecords("grants", { scope: record.scope }), [record])

  const originalConnect = pg.Pool.prototype.connect
  let connectionAttempts = 0
  let connectionOptions
  pg.Pool.prototype.connect = function () {
    connectionAttempts++
    connectionOptions = this.options
    throw new Error("Remote connection prevented by test.")
  }
  try {
    const remote = "postgresql://test-user:test-password@remote.example/learning"
    for (const suffix of ["", "?sslmode=disable", "?sslmode=require", "?sslmode=verify-ca"]) {
      await assert.rejects(
        async () => {
          const opened = provider(`${remote}${suffix}`)
          await opened.readRecords("grants", { scope: record.scope })
        },
        { code: "invalid_input" },
      )
    }
    await assert.rejects(
      async () => {
        const opened = provider("postgresql://localhost/learning?host=remote.example")
        await opened.readRecords("grants", { scope: record.scope })
      },
      { code: "invalid_input" },
    )
    assert.equal(connectionAttempts, 0)
    const secure = provider(`${remote}?sslmode=verify-full`)
    await assert.rejects(secure.readRecords("grants", { scope: record.scope }), {
      code: "unavailable",
    })
    assert.equal(connectionAttempts, 1)
    const tls = new pg.Client(connectionOptions).connectionParameters.ssl
    assert.ok(tls)
    assert.notEqual(tls.rejectUnauthorized, false)
    assert.equal(tls.checkServerIdentity, undefined)
  } finally {
    pg.Pool.prototype.connect = originalConnect
  }
})

it("tells callers to check the stored outcome before retrying an uncertain commit", async () => {
  const url = await database()
  const opened = provider(url)
  const scope = { repository: "a" }
  const record = { id: "uncertain", digest: "sha256:uncertain", scope }
  const originalQuery = pg.Client.prototype.query
  pg.Client.prototype.query = function (...args) {
    const result = originalQuery.apply(this, args)
    if (typeof args[0] === "string" && /^commit\b/i.test(args[0].trim())) {
      return result.then(() => {
        throw new Error("private-commit-diagnostic")
      })
    }
    return result
  }
  try {
    await assert.rejects(opened.appendRecords("grants", [record]), (error) => {
      assert.equal(error.code, "storage_outcome_unknown")
      assert.match(error.message, /(?:check|verify).*(?:retry|again)/i)
      assert.doesNotMatch(error.message, /private-commit-diagnostic/)
      return true
    })
  } finally {
    pg.Client.prototype.query = originalQuery
  }
  assert.deepEqual(await opened.readRecords("grants", { scope }), [record])
})

it("returns a safe error instead of crashing when a checked-out client fails", async () => {
  const url = await database()
  const script = `
    import pg from "pg"
    import { createPostgresMemoryProvider } from "./src/providers/postgres.mjs"
    import { migratePostgres } from "./src/providers/postgres-database.mjs"
    const query = pg.Client.prototype.query
    pg.Client.prototype.query = function (...args) {
      if (typeof args[0] === "string" && /^begin\\b/i.test(args[0].trim())) {
        return new Promise((_, reject) => setImmediate(() => {
          const error = new Error("private-client-diagnostic")
          this.emit("error", error)
          reject(error)
        }))
      }
      return query.apply(this, args)
    }
    const opened = createPostgresMemoryProvider({ connectionString: process.env.TEST_URL })
    try {
      for (const operation of [
        () => opened.appendRecords("grants", [{ id: "x", digest: "x", scope: { repository: "a" } }]),
        () => migratePostgres({ connectionString: process.env.TEST_URL }),
      ]) {
        try {
          await operation()
          throw new Error("The failure was not reported.")
        } catch (error) {
          if (error.code !== "unavailable" || error.message.includes("private-client-diagnostic"))
            throw error
        }
      }
    } finally {
      await opened.close()
    }
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, TEST_URL: url },
    encoding: "utf8",
    timeout: 10000,
  })
  assert.equal(result.status, 0, result.stderr)
})

it("times out when a PostgreSQL connection never finishes opening", async () => {
  const connections = new Set()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.on("close", () => connections.delete(socket))
    socket.on("error", () => {})
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const opened = provider(`postgresql://test:password@127.0.0.1:${server.address().port}/learning`)
  const pending = opened.health()
  let timer
  try {
    const health = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("PostgreSQL connection did not time out.")),
          15000,
        )
      }),
    ])
    assert.equal(health.ok, false)
  } finally {
    clearTimeout(timer)
    for (const socket of connections) socket.destroy()
    await pending.catch(() => {})
    await opened.close()
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

it("times out when every PostgreSQL pool connection is busy", async () => {
  const url = await database()
  const pool = await postgresPool(url)
  const clients = []
  let timer
  let waiting
  try {
    for (let index = 0; index < pool.options.max; index++) clients.push(await pool.connect())
    waiting = pool.connect()
    waiting.then(
      (client) => client.release(),
      () => {},
    )
    const outcome = await Promise.race([
      waiting.then(
        () => "connected",
        () => "timeout",
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("still waiting"), 15000)
      }),
    ])
    assert.equal(outcome, "timeout")
  } finally {
    clearTimeout(timer)
    for (const client of clients) client.release()
    await waiting?.catch(() => {})
    await pool.end()
  }
})

it("accepts an IPv6 PostgreSQL URL without exposing its credentials", async () => {
  const url = "postgresql://ipv6-user:ipv6-private-password@[::1]:1/learning"
  const opened = provider(url)
  const manifest = opened.manifest()
  assert.equal(validateRecord("providerManifest", manifest, { sealed: false }).valid, true)
  assert.deepEqual(manifest.externalCalls, ["[::1]:1"])
  const health = await opened.health()
  assert.equal(health.ok, false)
  await assert.rejects(opened.readRecords("grants", { scope: { repository: "a" } }), (error) => {
    assert.equal(error.code, "unavailable")
    const diagnostics = JSON.stringify({
      manifest,
      health,
      message: error.message,
      details: error.details,
    })
    assert.doesNotMatch(diagnostics, /ipv6-user|ipv6-private-password/)
    return true
  })
})

it("accepts Unix-socket URLs without exposing the socket path or credentials", async () => {
  const socket = fileURLToPath(
    new URL(`./absent-socket-${randomBytes(12).toString("hex")}`, import.meta.url),
  )
  const encoded = encodeURIComponent(socket)
  const urls = [
    `postgresql://socket-user:socket-private-password@${encoded}/learning`,
    `postgresql:///learning?host=${encoded}&user=socket-user&password=socket-private-password`,
    `postgresql://socket-user:socket-private-password@localhost/learning?host=${encoded}`,
  ]
  for (const url of urls) {
    const opened = provider(url)
    const manifest = opened.manifest()
    assert.equal(validateRecord("providerManifest", manifest, { sealed: false }).valid, true)
    assert.equal(manifest.storage.kind, "local")
    assert.deepEqual(manifest.externalCalls, [])
    const health = await opened.health()
    assert.equal(health.ok, false)
    await assert.rejects(opened.readRecords("grants", { scope: { repository: "a" } }), (error) => {
      assert.equal(error.code, "unavailable")
      const diagnostics = JSON.stringify({
        manifest,
        health,
        message: error.message,
        details: error.details,
      })
      assert.equal(diagnostics.includes(socket), false)
      assert.equal(diagnostics.includes(encoded), false)
      assert.doesNotMatch(diagnostics, /socket-user|socket-private-password/)
      return true
    })
  }
  let output = ""
  const code = await main(["migrate"], {
    env: { REPLICA_LEARNING_MIGRATION_DATABASE_URL: urls[1] },
    stdout: { write: (text) => (output += text) },
    stderr: { write: (text) => (output += text) },
  })
  assert.equal(code, 1)
  assert.equal(output.includes(socket), false)
  assert.equal(output.includes(encoded), false)
  assert.doesNotMatch(output, /socket-user|socket-private-password/)
})

it("reads and writes over an IPv6 connection when loopback is available", async (t) => {
  const url = await database()
  const target = new pg.Client({ connectionString: url }).connectionParameters
  const server = createServer((incoming) => {
    const destination = target.host.startsWith("/")
      ? { path: `${target.host}/.s.PGSQL.${target.port}` }
      : { host: target.host, port: target.port }
    const outgoing = createConnection(destination)
    incoming.on("error", () => outgoing.destroy())
    outgoing.on("error", () => incoming.destroy())
    incoming.pipe(outgoing).pipe(incoming)
  })
  const failure = await new Promise((resolve) => {
    server.once("error", resolve)
    server.listen(0, "::1", () => resolve(null))
  })
  if (failure) {
    if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(failure.code)) {
      t.skip("IPv6 loopback is unavailable.")
      return
    }
    throw failure
  }
  const ipv6Url = new URL(url)
  ipv6Url.hostname = "[::1]"
  ipv6Url.port = String(server.address().port)
  ipv6Url.searchParams.delete("host")
  ipv6Url.searchParams.delete("port")
  let opened
  try {
    opened = provider(ipv6Url.href)
    const record = { id: "ipv6-grant", digest: "sha256:ipv6", scope: { repository: "a" } }
    await opened.appendRecords("grants", [record])
    assert.deepEqual(await opened.readRecords("grants", { scope: record.scope }), [record])
  } finally {
    await opened?.close()
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

it("keeps SQLite usable when the optional PostgreSQL driver cannot load", () => {
  const script = `
    const { registerHooks } = await import("node:module")
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === "pg") throw new Error("pg is unavailable")
      return next(specifier, context)
    } })
    const { createSqliteMemoryProvider } = await import("./index.mjs")
    const provider = createSqliteMemoryProvider({ directory: "./test-database/no-sqlite-store" })
    if (!(await provider.health()).ok) process.exit(1)
    await provider.close()
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
})

it("serializes writes within a scope while another scope can write", async () => {
  const url = await database()
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  const first = provider(url)
  const second = provider(url)
  const scope = { repository: "a" }
  const other = { repository: "b" }
  function record(id, value) {
    return { id, digest: `sha256:${id}`, scope: value }
  }
  let blocked
  let next
  let outcomes
  try {
    await db.query(`
      create function replica_learning.test_hold_write() returns trigger language plpgsql as $$
      begin
        if new.id = 'held' then perform pg_advisory_xact_lock(764424); end if;
        return new;
      end $$
    `)
    await db.query(`
      create trigger test_hold_write before insert on replica_learning.records
      for each row execute function replica_learning.test_hold_write()
    `)
    await db.query("begin")
    await db.query("select pg_advisory_xact_lock(764424)")
    blocked = first.appendRecords("grants", [record("held", scope)])
    blocked.catch(() => {})
    async function waitForLocks(count) {
      const deadline = Date.now() + 5000
      while (true) {
        await db.query("select pg_stat_clear_snapshot()")
        const { rows } = await db.query(
          "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event = 'advisory'",
        )
        if (rows[0].count >= count) return
        assert.ok(Date.now() < deadline, `Expected ${count} waiting writes.`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await waitForLocks(1)
    next = second.appendRecords("grants", [record("next", scope)])
    next.catch(() => {})
    const independent = second.appendRecords("grants", [record("other", other)])
    let timer
    try {
      await Promise.race([
        independent,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Another scope could not write.")), 5000)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    await waitForLocks(2)
  } finally {
    await db.query("rollback")
    outcomes = await Promise.allSettled([blocked, next].filter(Boolean))
    await db.end()
  }
  assert.ok(outcomes.every((outcome) => outcome.status === "fulfilled"))
  assert.deepEqual(
    (await first.readRecords("grants", { scope })).map((entry) => entry.id),
    ["held", "next"],
  )
})

it("allows only one concurrent version based on the same previous digest", async () => {
  const url = await database()
  const first = provider(url)
  const second = provider(url)
  const scope = { repository: "a" }
  function version(number, digest) {
    return { id: "memory", scope, version: number, digest }
  }
  await first.appendMemoryVersion(version(1, "sha256:base"), { expectedPreviousDigest: null })
  const results = await Promise.allSettled(
    [first, second].map((writer, index) =>
      writer.appendMemoryVersion(version(2, `sha256:${index}`), {
        expectedPreviousDigest: "sha256:base",
      }),
    ),
  )
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1)
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "conflict")
  assert.equal((await first.readMemoryVersions({ scope })).length, 2)
})

it("treats a concurrent duplicate as existing under a repeatable-read default", async () => {
  const url = await database()
  const name = new URL(url).pathname.slice(1)
  await admin.query(
    `alter database "${name}" set default_transaction_isolation = 'repeatable read'`,
  )
  const holder = new pg.Client({ connectionString: url })
  await holder.connect()
  const first = provider(url)
  const second = provider(url)
  const record = { id: "duplicate", digest: "sha256:same", scope: { repository: "a" } }
  let writes
  let results
  try {
    await holder.query(`
      create function replica_learning.test_hold_duplicate() returns trigger language plpgsql as $$
      begin
        if new.id = 'duplicate' then perform pg_advisory_xact_lock(764425); end if;
        return new;
      end $$
    `)
    await holder.query(`
      create trigger test_hold_duplicate before insert on replica_learning.records
      for each row execute function replica_learning.test_hold_duplicate()
    `)
    await holder.query("begin")
    await holder.query("select pg_advisory_xact_lock(764425)")
    writes = [first.appendRecords("grants", [record]), second.appendRecords("grants", [record])]
    for (const write of writes) write.catch(() => {})
    const deadline = Date.now() + 5000
    while (true) {
      await holder.query("select pg_stat_clear_snapshot()")
      const { rows } = await holder.query(
        "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event = 'advisory'",
      )
      if (rows[0].count >= 2) break
      assert.ok(Date.now() < deadline, "Both writes must wait until the first write can commit.")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  } finally {
    await holder.query("rollback")
    results = await Promise.allSettled(writes ?? [])
    await holder.end()
  }
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  )
  assert.deepEqual(
    results.map((result) => result.value).sort((a, b) => a.appended - b.appended),
    [
      { appended: 0, existing: 1 },
      { appended: 1, existing: 0 },
    ],
  )
  assert.deepEqual(await first.readRecords("grants", { scope: record.scope }), [record])
})

it("never commits an older snapshot after a newer concurrent import", async () => {
  const url = await database()
  const olderProvider = provider(url)
  const newerProvider = provider(url)
  let release
  let reached
  const paused = new Promise((resolve) => (reached = resolve))
  const resume = new Promise((resolve) => (release = resolve))
  const wrapped = {
    ...olderProvider,
    async appendBatch(batch, options) {
      if (batch.collections?.length) {
        reached()
        await resume
      }
      return olderProvider.appendBatch(batch, options)
    },
  }
  function clock() {
    return Date.parse("2026-10-09T12:00:00Z")
  }
  const olderStore = await createLearningStore({ provider: wrapped, clock })
  const newerStore = await createLearningStore({ provider: newerProvider, clock })
  const grant = await olderStore.addGrant(designer(), {
    purposes: ["review"],
    sources: ["hub_review_comments"],
    basis: "The team agreed to learn from review comments.",
  })
  let older
  let newer
  try {
    older = olderStore.importHubReviewComments(agent(), weekOneLog(), { grantIds: [grant.id] })
    older.catch(() => {})
    let timer
    try {
      await Promise.race([
        paused,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("The older import did not reach its write.")),
            5000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    newer = newerStore.importHubReviewComments(agent(), weekTwoLog(), { grantIds: [grant.id] })
    let newestFirst
    try {
      newestFirst = await Promise.race([
        newer.then(
          () => true,
          () => true,
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 500)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    release()
    const [oldResult, newResult] = await Promise.allSettled([older, newer])
    if (newestFirst) {
      assert.equal(newResult.status, "fulfilled")
      assert.equal(oldResult.status, "rejected")
      assert.equal(oldResult.reason.code, "conflict")
    } else {
      assert.ok([oldResult, newResult].some((result) => result.status === "fulfilled"))
      for (const result of [oldResult, newResult])
        if (result.status === "rejected") assert.equal(result.reason.code, "conflict")
    }
    const collections = await newerProvider.readRecords("collections", { scope: designer().scope })
    const captured = collections.map((item) => item.capturedAt)
    assert.deepEqual(captured, [...captured].sort())
    if (newResult.status === "fulfilled") {
      const { events } = await newerStore.queryObservations(designer(), { purpose: "review" })
      assert.ok(
        events.find((event) => event.payload?.commentId === 112).payload.body.includes("16px"),
      )
    }
  } finally {
    release()
    await Promise.allSettled([older, newer].filter(Boolean))
  }
})

it("uses indexes for selective scope, ID, episode, time, and operation queries", async () => {
  const url = await database()
  const db = new pg.Client({ connectionString: url })
  await db.connect()
  try {
    await db.query(`
      insert into replica_learning.records
        (stream, id, scope_key, occurred_at, episode_id, operation, digest, body)
      select 'events', 'event-' || n, '{"repository":"repo-' || (n % 50) || '"}',
        '2026-10-' || lpad(((n % 28) + 1)::text, 2, '0') || 'T00:00:00Z',
        'episode-' || (n % 1000), 'operation-' || (n % 200), 'sha256:' || n, '{}'
      from generate_series(1, 100000) as n;
      insert into replica_learning.memory_versions
        (id, version, scope_key, updated_at, operation, digest, body)
      select 'memory-' || n, 1, '{"repository":"repo-' || (n % 50) || '"}',
        '2026-10-' || lpad(((n % 28) + 1)::text, 2, '0') || 'T00:00:00Z',
        'operation-' || (n % 200), 'sha256:' || n, '{}'
      from generate_series(1, 50000) as n;
      analyze replica_learning.records;
      analyze replica_learning.memory_versions;
    `)
    const scope = { repository: "repo-1" }
    const opened = provider(url)
    const queries = []
    const originalQuery = pg.Pool.prototype.query
    pg.Pool.prototype.query = function (...args) {
      if (
        typeof args[0] === "string" &&
        /\bselect\b[\s\S]*\bfrom\s+replica_learning\.(records|memory_versions)\b/i.test(args[0])
      )
        queries.push(args)
      return originalQuery.apply(this, args)
    }
    try {
      await opened.readRecords("events", { scope })
      await opened.readRecords("events", { scope, ids: ["event-1"] })
      await opened.readRecords("events", { scope, episodeIds: ["episode-1"] })
      await opened.readRecords("events", { scope, since: "2026-10-01", until: "2026-10-02" })
      await opened.readRecords("events", { scope, operations: ["operation-1"] })
      await opened.readMemoryVersions({ scope, ids: ["memory-1"] })
      await opened.readMemoryVersions({ scope, since: "2026-10-01", until: "2026-10-02" })
      await opened.readMemoryVersions({ scope, operations: ["operation-1"] })
    } finally {
      pg.Pool.prototype.query = originalQuery
    }
    assert.equal(queries.length, 8)
    function usesIndex(node) {
      return /Index.*Scan/.test(node["Node Type"]) || (node.Plans ?? []).some(usesIndex)
    }
    for (const [sql, values] of queries) {
      const { rows } = await db.query(`explain (format json) ${sql}`, values)
      assert.ok(usesIndex(rows[0]["QUERY PLAN"][0].Plan), sql)
    }
  } finally {
    await db.end()
  }
})
