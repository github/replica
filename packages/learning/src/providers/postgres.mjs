import { canonicalJson } from "../canonical-json.mjs"
import { LearningError, ProviderConflictError } from "../errors.mjs"
import {
  PROVIDER_CONTRACT,
  REDACT_CAPABILITY,
  REQUIRED_CAPABILITIES,
  STREAMS,
  assertQuery,
  assertStorable,
  assertStream,
  batchWrites,
  redactionProblem,
} from "../provider-contract.mjs"
import { PRODUCER, SCHEMA_VERSIONS } from "../records.mjs"
import {
  assertPostgresSchema,
  postgresDestination,
  postgresError,
  postgresPool,
} from "./postgres-database.mjs"

/**
 * Store exact JSON in the separately migrated replica_learning schema. The connection URL
 * belongs in the host's environment, not the learning config or provider manifest.
 */
export function createPostgresMemoryProvider({ connectionString } = {}) {
  const destination = postgresDestination(connectionString)
  let poolPromise
  function pool() {
    if (!poolPromise) {
      const opening = (async () => {
        const instance = await postgresPool(connectionString)
        try {
          await assertPostgresSchema(instance)
          return instance
        } catch (error) {
          await instance.end().catch(() => {})
          throw postgresError(error)
        }
      })()
      poolPromise = opening
      opening.catch(() => {
        if (poolPromise === opening) poolPromise = undefined
      })
    }
    return poolPromise
  }

  async function query(sql, values) {
    try {
      return await (await pool()).query(sql, values)
    } catch (error) {
      throw postgresError(error)
    }
  }

  /** Scope locks serialize writes across processes without blocking other repositories. */
  async function transaction(scopes, work) {
    let client
    let committing = false
    let discard = false
    try {
      client = await (await pool()).connect()
      await client.query("begin")
      for (const scope of [...new Set(scopes)].sort())
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `replica_learning.scope:${scope}`,
        ])
      const result = await work(client)
      committing = true
      await client.query("commit")
      committing = false
      return result
    } catch (error) {
      if (committing) discard = true
      else if (client)
        await client.query("rollback").catch(() => {
          discard = true
        })
      if (error?.code === "23505")
        throw new ProviderConflictError("A PostgreSQL record changed since it was read.")
      throw postgresError(error, { committing })
    } finally {
      client?.release(discard)
    }
  }

  async function insert(client, stream, records) {
    if (!records.length) return { appended: 0, existing: 0 }
    const unique = new Map()
    for (const record of records) {
      const scope = canonicalJson(record.scope)
      const previous = unique.get(record.id)
      if (previous && (previous.digest !== record.digest || previous.scope !== scope))
        throw new ProviderConflictError(`${stream} already holds a different record with that ID.`)
      if (!previous) unique.set(record.id, { record, scope, digest: record.digest })
    }
    const items = [...unique.values()]
    const inserted = await client.query(
      `insert into replica_learning.records
        (stream, id, scope_key, occurred_at, episode_id, operation, digest, body)
       select $1, id, scope_key, occurred_at, episode_id, operation, digest, body
       from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::text[], $8::text[]) with ordinality
         as item(id, scope_key, occurred_at, episode_id, operation, digest, body, ordinal)
       order by ordinal
       on conflict (stream, id) do nothing returning id`,
      [
        stream,
        items.map(({ record }) => record.id),
        items.map(({ scope }) => scope),
        items.map(({ record }) => text(record[STREAMS[stream]])),
        items.map(({ record }) => text(stream === "episodes" ? record.id : record.episodeId)),
        items.map(({ record }) => text(record.operation)),
        items.map(({ digest }) => digest),
        items.map(({ record }) => JSON.stringify(record)),
      ],
    )
    const stored = await client.query(
      "select id, scope_key, digest from replica_learning.records where stream = $1 and id = any($2::text[])",
      [stream, [...unique.keys()]],
    )
    for (const row of stored.rows) {
      const expected = unique.get(row.id)
      if (row.digest !== expected.digest || row.scope_key !== expected.scope)
        throw new ProviderConflictError(`${stream} already holds a different record with that ID.`)
    }
    return { appended: inserted.rowCount, existing: records.length - inserted.rowCount }
  }

  async function write(batch, { audit = [] } = {}) {
    const writes = batchWrites(batch, audit)
    const scopes = [...writes.values()].flat().map((record) => canonicalJson(record.scope))
    return transaction(scopes, async (client) => {
      const counts = {}
      for (const [stream, records] of writes) {
        const result = await insert(client, stream, records)
        if (Object.hasOwn(batch, stream)) counts[stream] = result
      }
      return counts
    })
  }

  async function select(queryOptions, { table, stream, time, episode }) {
    assertQuery(queryOptions)
    if (queryOptions.episodeIds && !episode) return []
    const values = []
    const conditions = []
    function add(column, operator, value, cast = "") {
      values.push(value)
      conditions.push(`${column} ${operator} $${values.length}${cast}`)
    }
    if (stream) add("stream", "=", stream)
    add("scope_key", "=", canonicalJson(queryOptions.scope))
    if (queryOptions.ids) add("id", "= any(", queryOptions.ids, "::text[])")
    if (queryOptions.operations) add("operation", "= any(", queryOptions.operations, "::text[])")
    if (queryOptions.episodeIds) add(episode, "= any(", queryOptions.episodeIds, "::text[])")
    if (queryOptions.since) add(time, ">=", queryOptions.since)
    if (queryOptions.until) add(time, "<", queryOptions.until)
    const result = await query(
      `select body from replica_learning.${table} where ${conditions.join(" and ")} order by seq`,
      values,
    )
    try {
      return result.rows.map((row) => JSON.parse(row.body))
    } catch {
      throw new LearningError("storage_corrupt", "A PostgreSQL record contains invalid JSON.")
    }
  }

  return {
    manifest() {
      return {
        schemaVersion: SCHEMA_VERSIONS.providerManifest,
        id: "postgres",
        name: "PostgreSQL",
        version: PRODUCER.version,
        contract: { name: PROVIDER_CONTRACT.name, versions: [PROVIDER_CONTRACT.version] },
        capabilities: [...REQUIRED_CAPABILITIES, REDACT_CAPABILITY],
        storage: {
          kind: destination.socket ? "local" : "remote",
          location: "PostgreSQL replica_learning schema",
        },
        externalCalls: [...destination.externalCalls],
        dataRetention:
          "Records remain until deleted. Old row versions, write-ahead logs and backups may retain redacted text.",
      }
    },

    async health() {
      try {
        await query("select 1 from replica_learning.records limit 1")
        await query("select 1 from replica_learning.memory_versions limit 1")
        return { ok: true, detail: "PostgreSQL learning tables are accessible." }
      } catch {
        return { ok: false, detail: "PostgreSQL learning tables are unavailable." }
      }
    },

    async appendRecords(stream, records, options) {
      assertStream(stream)
      return (await write({ [stream]: records }, options))[stream]
    },

    async appendBatch(batch, options) {
      return write(batch, options)
    },

    async readRecords(stream, queryOptions) {
      assertStream(stream)
      return select(queryOptions, {
        table: "records",
        stream,
        time: "occurred_at",
        episode: "episode_id",
      })
    },

    async appendMemoryVersion(record, { expectedPreviousDigest = null, audit = [] } = {}) {
      assertStorable([record])
      assertStorable(audit)
      if (!Number.isSafeInteger(record.version) || record.version < 1)
        throw new LearningError("invalid_input", "A memory version needs a positive version.")
      const scope = canonicalJson(record.scope)
      await transaction(
        [scope, ...audit.map((entry) => canonicalJson(entry.scope))],
        async (client) => {
          const { rows } = await client.query(
            "select version, digest, scope_key from replica_learning.memory_versions where id = $1 order by version desc limit 1",
            [record.id],
          )
          const latest = rows[0]
          if (
            (latest?.digest ?? null) !== expectedPreviousDigest ||
            record.version !== (latest?.version ?? 0) + 1 ||
            (latest && latest.scope_key !== scope)
          )
            throw new ProviderConflictError("The memory changed since it was read.")
          await client.query(
            `insert into replica_learning.memory_versions
            (id, version, scope_key, updated_at, operation, digest, body)
           values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              record.id,
              record.version,
              scope,
              text(record.updatedAt),
              text(record.operation),
              record.digest,
              JSON.stringify(record),
            ],
          )
          await insert(client, "audit", audit)
        },
      )
    },

    async readMemoryVersions(queryOptions) {
      return select(queryOptions, { table: "memory_versions", time: "updated_at" })
    },

    async redactRecord(stream, record) {
      if (stream !== "events")
        throw new LearningError("invalid_input", "Only events can be redacted.")
      if (!record?.scope)
        throw new LearningError("invalid_input", "A redacted event needs a scope.")
      const scope = canonicalJson(record.scope)
      return transaction([scope], async (client) => {
        const { rows } = await client.query(
          "select body from replica_learning.records where stream = 'events' and id = $1 and scope_key = $2",
          [record.id, scope],
        )
        let stored
        try {
          stored = rows.length ? JSON.parse(rows[0].body) : undefined
        } catch {
          throw new LearningError("storage_corrupt", "A PostgreSQL record contains invalid JSON.")
        }
        const problem = redactionProblem(stored, record)
        if (problem) throw problem
        if (stored.payload === undefined) return { redacted: false }
        await client.query(
          "update replica_learning.records set body = $1 where stream = 'events' and id = $2 and scope_key = $3",
          [JSON.stringify(record), record.id, scope],
        )
        return { redacted: true }
      })
    },

    async close() {
      if (poolPromise) {
        const instance = await poolPromise.catch(() => null)
        if (instance)
          await instance.end().catch((error) => {
            throw postgresError(error)
          })
      }
      poolPromise = undefined
    },
  }
}

function text(value) {
  return typeof value === "string" ? value : null
}
