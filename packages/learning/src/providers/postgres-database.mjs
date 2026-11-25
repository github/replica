import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { domainToASCII } from "node:url"
import { LearningError } from "../errors.mjs"

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      create table replica_learning.records (
        seq bigint generated always as identity primary key,
        stream text collate "C" not null,
        id text collate "C" not null,
        scope_key text collate "C" not null,
        occurred_at text collate "C",
        episode_id text collate "C",
        operation text collate "C",
        digest text collate "C" not null,
        body text not null,
        unique (stream, id)
      );
      create index records_by_scope on replica_learning.records (stream, scope_key, seq);
      create index records_by_scope_id on replica_learning.records (stream, scope_key, id);
      create index records_by_episode on replica_learning.records (stream, scope_key, episode_id);
      create index records_by_time on replica_learning.records (stream, scope_key, occurred_at);
      create index records_by_operation on replica_learning.records (stream, scope_key, operation);
      create table replica_learning.memory_versions (
        seq bigint generated always as identity primary key,
        id text collate "C" not null,
        version integer not null,
        scope_key text collate "C" not null,
        updated_at text collate "C",
        operation text collate "C",
        digest text collate "C" not null,
        body text not null,
        unique (id, version)
      );
      create index memory_versions_by_scope on replica_learning.memory_versions (scope_key, seq);
      create index memory_versions_by_scope_id on replica_learning.memory_versions (scope_key, id);
      create index memory_versions_by_time on replica_learning.memory_versions (scope_key, updated_at);
      create index memory_versions_by_operation on replica_learning.memory_versions (scope_key, operation);
    `,
  },
]

function checksum(migration) {
  return createHash("sha256").update(migration.sql).digest("hex")
}

function assertLedger(rows, { complete }) {
  if (
    rows.length > MIGRATIONS.length ||
    (complete && rows.length !== MIGRATIONS.length) ||
    rows.some(
      (row, index) =>
        row.version !== MIGRATIONS[index].version || row.checksum !== checksum(MIGRATIONS[index]),
    )
  )
    throw new LearningError("storage_corrupt", "The PostgreSQL migration ledger is incompatible.")
}

/** Refuse an unmigrated or incompatible schema without changing it. */
export async function assertPostgresSchema(pool) {
  const { rows } = await pool.query(
    "select version, checksum from replica_learning.schema_migrations order by version",
  )
  assertLedger(rows, { complete: true })
}

/** Describe the destination without including credentials or local socket paths. */
export function postgresDestination(connectionString) {
  try {
    let url
    let emptyHost = false
    try {
      url = new URL(connectionString)
    } catch {
      // pg accepts an empty authority after credentials, which Node's URL parser rejects.
      url = new URL(connectionString.replace("@/", "@replica-placeholder/"))
      emptyHost = true
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error()
    const hostname = emptyHost ? "" : decodeURIComponent(url.hostname).replace(/^\[|\]$/g, "")
    const host =
      url.searchParams.getAll("host").at(-1) || hostname || process.env.PGHOST || "localhost"
    if (host.startsWith("/")) return { socket: true, externalCalls: [] }
    const local =
      host.toLowerCase() === "localhost" ||
      host === "::1" ||
      (isIP(host) === 4 && host.startsWith("127."))
    if (!local && url.searchParams.getAll("sslmode").at(-1) !== "verify-full")
      throw new LearningError(
        "invalid_input",
        "Remote PostgreSQL connections require sslmode=verify-full.",
      )
    const port = url.searchParams.getAll("port").at(-1) || url.port || process.env.PGPORT || ""
    const address = isIP(host) === 6 ? `[${host}]` : domainToASCII(host)
    const destination = `${address}${port ? `:${port}` : ""}`
    if (
      destination.length > 255 ||
      !/^(?:[A-Za-z0-9._-]+(?::[0-9]{1,5})?|\[[0-9A-Za-z:.%_-]+\](?::[0-9]{1,5})?)$/.test(
        destination,
      )
    )
      throw new Error()
    return { socket: false, externalCalls: [destination] }
  } catch (error) {
    if (error instanceof LearningError) throw error
    throw new LearningError("invalid_input", "A valid PostgreSQL connection URL is required.")
  }
}

/** Load the optional driver only when PostgreSQL is selected. */
export async function postgresPool(connectionString) {
  postgresDestination(connectionString)
  let pg
  try {
    pg = await import("pg")
  } catch {
    throw new LearningError("unsupported", "The optional pg dependency is not installed.")
  }
  try {
    const pool = new pg.default.Pool({ connectionString, connectionTimeoutMillis: 10_000 })
    pool.on("error", () => {})
    pool.on("connect", (client) => client.on("error", () => {}))
    return pool
  } catch (error) {
    throw postgresError(error)
  }
}

/** Hide connection details and server-supplied SQL errors from callers. */
export function postgresError(error, { committing = false } = {}) {
  if (error instanceof LearningError) return error
  return new LearningError(
    committing ? "storage_outcome_unknown" : "unavailable",
    committing
      ? "PostgreSQL could not confirm the transaction. Check the stored outcome before retrying."
      : "PostgreSQL could not complete the operation. Check the connection, permissions, and migration.",
  )
}

/** Apply package-owned migrations once, including concurrent or interrupted setup attempts. */
export async function migratePostgres({ connectionString } = {}) {
  const pool = await postgresPool(connectionString)
  let client
  let committing = false
  let discard = false
  try {
    client = await pool.connect()
    await client.query("begin isolation level read committed")
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "replica_learning.schema_migrations",
    ])
    await client.query("create schema if not exists replica_learning")
    await client.query(`
      create table if not exists replica_learning.schema_migrations (
        version integer primary key,
        checksum text not null
      )
    `)
    const { rows } = await client.query(
      "select version, checksum from replica_learning.schema_migrations order by version",
    )
    assertLedger(rows, { complete: false })
    for (const migration of MIGRATIONS) {
      if (rows.some((row) => row.version === migration.version)) continue
      await client.query(migration.sql)
      await client.query(
        "insert into replica_learning.schema_migrations (version, checksum) values ($1, $2)",
        [migration.version, checksum(migration)],
      )
    }
    committing = true
    await client.query("commit")
    committing = false
    return { version: MIGRATIONS.at(-1).version }
  } catch (error) {
    if (committing) discard = true
    else if (client)
      await client.query("rollback").catch(() => {
        discard = true
      })
    throw postgresError(error, { committing })
  } finally {
    client?.release(discard)
    await pool.end().catch((error) => {
      throw postgresError(error)
    })
  }
}
