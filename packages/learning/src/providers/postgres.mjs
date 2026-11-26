import { canonicalJson, digestOf } from "../canonical-json.mjs"
import { LearningError, ProviderConflictError } from "../errors.mjs"
import {
  PROVIDER_CONTRACT,
  REDACT_CAPABILITY,
  REQUIRED_CAPABILITIES,
  STREAMS,
  assertQuery,
  assertDecisionFence,
  assertStorable,
  assertStream,
  batchWrites,
  decisionGenerationFence,
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
      await client.query("begin isolation level read committed")
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

  async function assertMigrations(client, expectedMigrations) {
    if (!expectedMigrations) return
    const { rows } = await client.query(
      "select metadata from replica_learning.scope_migrations where new_scope_key = $1 order by seq",
      [canonicalJson(expectedMigrations.scope)],
    )
    let migrations
    try {
      migrations = rows.map((row) => JSON.parse(row.metadata))
    } catch {
      throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
    }
    if (digestOf(migrations) !== expectedMigrations.digest)
      throw new ProviderConflictError("Repository migration changed during the write.")
  }

  /** Read one scope's generation; writers lock it before checking a decision. */
  async function fence(client, scope, lock = false) {
    const key = canonicalJson(scope)
    if (lock)
      await client.query(
        `insert into replica_learning.decision_generations (scope_key, generation)
         values ($1, 0) on conflict (scope_key) do nothing`,
        [key],
      )
    const { rows } = await client.query(
      `select generation from replica_learning.decision_generations
       where scope_key = $1${lock ? " for update" : ""}`,
      [key],
    )
    return decisionGenerationFence(scope, rows[0]?.generation ?? 0)
  }

  async function write(batch, { audit = [], expectedCollection, expectedMigrations } = {}) {
    const writes = batchWrites(batch, audit)
    const scopes = [...writes.values()].flat().map((record) => canonicalJson(record.scope))
    if (expectedCollection) scopes.push(canonicalJson(expectedCollection.scope))
    if (expectedMigrations) scopes.push(canonicalJson(expectedMigrations.scope))
    return transaction(scopes, async (client) => {
      await assertMigrations(client, expectedMigrations)
      if (expectedCollection) {
        const { rows } = await client.query(
          `select id, digest from replica_learning.records
           where stream = 'collections' and scope_key = $1
           order by id`,
          [canonicalJson(expectedCollection.scope)],
        )
        if (canonicalJson(rows) !== canonicalJson(expectedCollection.records))
          throw new ProviderConflictError("The collection history changed during import.")
      }
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
    atomicDecisionFence: true,
    atomicCollectionImport: true,
    atomicMigrationRedactions: true,
    atomicMigrationFence: true,

    async decisionFence(scope) {
      assertQuery({ scope })
      const { rows } = await query(
        "select generation from replica_learning.decision_generations where scope_key = $1",
        [canonicalJson(scope)],
      )
      return decisionGenerationFence(scope, rows[0]?.generation ?? 0)
    },

    async readDecisionMemoryIds(scope, ids) {
      assertQuery({ scope })
      const { rows } = await query(
        `with recursive linked(id) as (
          select unnest($2::text[]) collate "C"
          union
          select neighbor.id from linked
          join lateral (
            select target_id as id from replica_learning.decision_memory_targets
              where scope_key = $1 and source_id = linked.id
            union
            select source_id as id from replica_learning.decision_memory_targets
              where scope_key = $1 and target_id = linked.id
          ) as neighbor on true
        )
        select id from linked limit 1001`,
        [canonicalJson(scope), ids],
      )
      if (rows.length > 1000)
        throw new LearningError("unsupported", "The learning replacement history is too large.")
      return rows.map((row) => row.id)
    },

    async readRelatedEpisodeIds(scope, ids) {
      assertQuery({ scope })
      const { rows } = await query(
        `with selected as (
          select body::jsonb -> 'source' as source
          from replica_learning.records
          where stream = 'episodes' and scope_key = $1 and id = any($2::text[])
        )
        select distinct related.id
        from selected
        join replica_learning.records as related
          on related.scope_key = $1 and related.stream = 'episodes'
          and (related.body::jsonb -> 'source') ->> 'kind' = 'hub_review_comments'
          and (related.body::jsonb -> 'source') -> 'hubOrigin' = selected.source -> 'hubOrigin'
          and (related.body::jsonb -> 'source') -> 'repositoryId' = selected.source -> 'repositoryId'
          and (related.body::jsonb -> 'source') -> 'prototypeId' = selected.source -> 'prototypeId'
          and (related.body::jsonb -> 'source') -> 'threadId' = selected.source -> 'threadId'
        where selected.source ->> 'kind' = 'hub_review_comments'`,
        [canonicalJson(scope), ids],
      )
      return [...new Set([...ids, ...rows.map((row) => row.id)])]
    },

    async readDecisionInputs(scope, { evidence, at, purpose, hubSources, eventIds }) {
      assertQuery({ scope, ids: eventIds })
      const key = canonicalJson(scope)
      const grantsResult = await query(
        `with candidate_grants as materialized (
          select distinct grant_id from replica_learning.decision_grant_sources as source
          where scope_key = $1 and source.source = any($2::text[])
            and purpose = $4 and granted_at <= $3 and expires_at > $3
            and exists (
              select 1 from jsonb_to_recordset($5::jsonb) as evidence(source text, at text)
              where source.source = evidence.source
                and (source.evidence_from is null or source.evidence_from <= evidence.at)
                and (source.evidence_until is null or source.evidence_until > evidence.at)
            )
         )
         select body from replica_learning.records as grant_record
         where stream = 'grants' and scope_key = $1
           and id = any(array(select grant_id from candidate_grants))
         order by seq`,
        [
          key,
          [...new Set(evidence.map((item) => item.source))],
          at,
          purpose,
          JSON.stringify(evidence),
        ],
      )
      let grants
      try {
        grants = grantsResult.rows.map((row) => JSON.parse(row.body))
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL record contains invalid JSON.")
      }
      const grantIds = grants.map((grant) => grant.id)
      // Adopting stable reviewer IDs is permanent, so the earliest stable collection for a
      // source is enough to prove it. Reading one row keeps decisions bounded.
      const [withdrawalResult, collectionResult, originResult] = await Promise.all([
        query(
          `select distinct withdrawal.seq, withdrawal.body
           from replica_learning.decision_withdrawal_targets as target
           left join replica_learning.records as withdrawal
             on withdrawal.stream = 'withdrawals' and withdrawal.id = target.withdrawal_id
             and withdrawal.scope_key = target.scope_key
           where target.scope_key = $1 and target.grant_id = any($2::text[])
           order by withdrawal.seq`,
          [key, grantIds],
        ),
        query(
          `select distinct collection.seq, collection.body
           from jsonb_array_elements($2::jsonb) as source(value)
           cross join lateral (
             select seq, body from replica_learning.records
             where stream = 'collections' and scope_key = $1
             and (body::jsonb) ->> 'reviewerIdentity' = 'stable-user-id'
             and coalesce((body::jsonb -> 'source') -> 'hubOrigin', 'null'::jsonb)
               = coalesce(source.value -> 'hubOrigin', 'null'::jsonb)
             and coalesce((body::jsonb -> 'source') -> 'repositoryId', 'null'::jsonb)
               = coalesce(source.value -> 'repositoryId', 'null'::jsonb)
             order by seq
             limit 1
           ) as collection
           order by collection.seq`,
          [key, JSON.stringify(hubSources)],
        ),
        query(
          `select kind, record_id as id, old_scope_key as origin
           from replica_learning.decision_migration_origins
           where scope_key = $1 and (
             (kind = 'grant' and record_id = any($2::text[])) or
             (kind = 'event' and record_id = any($3::text[]))
           ) order by migration_id`,
          [key, grantIds, eventIds],
        ),
      ])
      let snapshots
      try {
        snapshots = collectionResult.rows.map((row) => JSON.parse(row.body).snapshotId)
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL record contains invalid JSON.")
      }
      const collections = await query(
        `select body from replica_learning.records
         where stream = 'collections' and scope_key = $1
           and (body::jsonb) ->> 'snapshotId' = any($2::text[])
         order by seq`,
        [key, snapshots],
      )
      try {
        return {
          grants,
          withdrawals: withdrawalResult.rows.map((row) => JSON.parse(row.body)),
          collections: collections.rows.map((row) => JSON.parse(row.body)),
          origins: originResult.rows,
        }
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL record contains invalid JSON.")
      }
    },

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

    async appendMemoryVersion(
      record,
      { expectedPreviousDigest = null, expectedDecisionFence, audit = [], expectedMigrations } = {},
    ) {
      assertStorable([record])
      assertStorable(audit)
      if (!Number.isSafeInteger(record.version) || record.version < 1)
        throw new LearningError("invalid_input", "A memory version needs a positive version.")
      const scope = canonicalJson(record.scope)
      await transaction(
        [
          scope,
          ...audit.map((entry) => canonicalJson(entry.scope)),
          ...(expectedMigrations ? [canonicalJson(expectedMigrations.scope)] : []),
        ],
        async (client) => {
          await assertMigrations(client, expectedMigrations)
          if (expectedDecisionFence !== undefined)
            assertDecisionFence(expectedDecisionFence, await fence(client, record.scope, true))
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

    async scopeMigrations(scope) {
      const { rows } = await query(
        "select metadata from replica_learning.scope_migrations where new_scope_key = $1 order by seq",
        [canonicalJson(scope)],
      )
      try {
        return rows.map((row) => JSON.parse(row.metadata))
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
      }
    },

    async scopeMigrationSummaries(scope) {
      const { rows } = await query(
        `select old_scope_key, metadata::jsonb -> 'redactionFollowUps' as follow_ups
         from replica_learning.scope_migrations where new_scope_key = $1 order by seq`,
        [canonicalJson(scope)],
      )
      try {
        return rows.map((row) => ({
          oldScope: JSON.parse(row.old_scope_key),
          ...(row.follow_ups ? { redactionFollowUps: row.follow_ups } : {}),
        }))
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
      }
    },

    async scopeMigrationIdentityFrom(scope) {
      const { rows } = await query(
        `select old_scope_key, new_scope_key, metadata::jsonb -> 'oldScope' as old_scope,
           metadata::jsonb -> 'newScope' as new_scope
         from replica_learning.scope_migrations
         where old_scope_key = $1`,
        [canonicalJson(scope)],
      )
      try {
        if (!rows.length) return null
        const row = rows[0]
        if (
          canonicalJson(row.old_scope) === row.old_scope_key &&
          canonicalJson(row.new_scope) === row.new_scope_key
        )
          return { oldScope: row.old_scope, newScope: row.new_scope }
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
      }
      throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
    },

    async scopeMigrationFrom(scope) {
      const { rows } = await query(
        "select metadata from replica_learning.scope_migrations where old_scope_key = $1",
        [canonicalJson(scope)],
      )
      try {
        return rows.length ? JSON.parse(rows[0].metadata) : null
      } catch {
        throw new LearningError("storage_corrupt", "A PostgreSQL migration mapping is invalid.")
      }
    },

    async registerLegacyScope(oldScope, newScope) {
      const oldKey = canonicalJson(oldScope)
      const newKey = canonicalJson(newScope)
      const saved = await query(
        "select new_scope_key from replica_learning.scope_migrations where old_scope_key = $1",
        [oldKey],
      )
      if (saved.rows.length) {
        if (saved.rows[0].new_scope_key !== newKey)
          throw new LearningError("conflict", "The old scope belongs to another repository.")
        return
      }
      return transaction([oldKey, newKey], async (client) => {
        const previous = await client.query(
          "select new_scope_key from replica_learning.scope_migrations where old_scope_key = $1",
          [oldKey],
        )
        if (previous.rows.length) {
          if (previous.rows[0].new_scope_key !== newKey)
            throw new LearningError("conflict", "The old scope belongs to another repository.")
          return
        }
        const old = await client.query(
          `select 1 from replica_learning.records where scope_key = $1
           union all select 1 from replica_learning.memory_versions where scope_key = $1
           limit 1`,
          [oldKey],
        )
        if (old.rows.length)
          throw new LearningError("conflict", "The old repository scope still contains data.")
        await client.query(
          `insert into replica_learning.scope_migrations (old_scope_key, new_scope_key, metadata)
           values ($1, $2, $3)`,
          [oldKey, newKey, JSON.stringify({ oldScope, newScope, digestMappings: [] })],
        )
      })
    },

    async hasSqliteImport(scope) {
      const { rows } = await query(
        "select 1 from replica_learning.sqlite_imports where scope_key = $1",
        [canonicalJson(scope)],
      )
      return rows.length > 0
    },

    async importSqlite({ scope, records, memories, migrations, sourceDigest, beforeCommit }) {
      const key = canonicalJson(scope)
      const writes = batchWrites(records)
      assertStorable(memories)
      for (const items of writes.values())
        if (items.some((record) => canonicalJson(record.scope) !== key))
          throw new LearningError("storage_corrupt", "The source contains another scope.")
      if (memories.some((record) => canonicalJson(record.scope) !== key))
        throw new LearningError("storage_corrupt", "The source contains another scope.")
      for (const migration of migrations)
        if (
          !migration.oldScope ||
          canonicalJson(migration.oldScope) === key ||
          canonicalJson(migration.newScope) !== key
        )
          throw new LearningError("storage_corrupt", "A repository migration mapping is invalid.")
      const scopes = [key, ...migrations.map((migration) => canonicalJson(migration.oldScope))]
      return transaction(scopes, async (client) => {
        const prior = await client.query(
          "select source_digest from replica_learning.sqlite_imports where scope_key = $1",
          [key],
        )
        if (prior.rows.length) {
          if (prior.rows[0].source_digest !== sourceDigest)
            throw new LearningError(
              "conflict",
              "The SQLite source changed after import. Keep it offline and investigate.",
            )
          return { alreadyImported: true }
        }
        const occupied = await client.query(
          `select 1 from replica_learning.records where scope_key = $1
           union all select 1 from replica_learning.memory_versions where scope_key = $1
           union all select 1 from replica_learning.scope_migrations where new_scope_key = $1
           limit 1`,
          [key],
        )
        if (occupied.rows.length)
          throw new LearningError("conflict", "The PostgreSQL repository already contains data.")
        for (const [stream, items] of writes) await insert(client, stream, items)
        const latest = new Map()
        for (const record of memories) {
          const previous = latest.get(record.id)
          if (
            record.version !== (previous?.version ?? 0) + 1 ||
            (record.previousDigest ?? null) !== (previous?.digest ?? null)
          )
            throw new LearningError("storage_corrupt", "A source memory history is invalid.")
          await client.query(
            `insert into replica_learning.memory_versions
             (id, version, scope_key, updated_at, operation, digest, body)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              record.id,
              record.version,
              key,
              text(record.updatedAt),
              text(record.operation),
              record.digest,
              JSON.stringify(record),
            ],
          )
          latest.set(record.id, record)
        }
        for (const migration of migrations)
          await client.query(
            `insert into replica_learning.scope_migrations (old_scope_key, new_scope_key, metadata)
             values ($1, $2, $3)`,
            [canonicalJson(migration.oldScope), key, JSON.stringify(migration)],
          )
        await beforeCommit()
        await client.query(
          "insert into replica_learning.sqlite_imports (scope_key, source_digest) values ($1, $2)",
          [key, sourceDigest],
        )
        return { alreadyImported: false }
      })
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
