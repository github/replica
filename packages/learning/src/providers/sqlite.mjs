import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
} from "node:fs"
import path from "node:path"
import { backup, DatabaseSync } from "node:sqlite"
import { canonicalJson, digestOf } from "../canonical-json.mjs"
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
import { NO_FOLLOW, assertOwnPath, assertSameFile, openError } from "./files.mjs"

// The busy timeout comes first, so opening waits for another process instead of failing.
const SCHEMA = `
  pragma busy_timeout = 10000;
  pragma journal_mode = wal;
  pragma secure_delete = on;
  create table if not exists records (
    seq integer primary key autoincrement,
    stream text not null,
    id text not null,
    scope_key text not null,
    occurred_at text,
    episode_id text,
    digest text not null,
    body text not null,
    unique (stream, id)
  );
  create index if not exists records_by_scope on records (stream, scope_key, seq);
  create index if not exists records_by_operation
    on records (stream, scope_key, json_extract(body, '$.operation'), seq);
  create table if not exists memory_versions (
    seq integer primary key autoincrement,
    id text not null,
    version integer not null,
    scope_key text not null,
    updated_at text,
    digest text not null,
    body text not null,
    unique (id, version)
  );
  create index if not exists memory_versions_by_scope on memory_versions (scope_key, seq);
`

/** Copy a stopped store without creating or migrating its source. */
export async function backupSqliteMemoryStore(
  { directory, file = "learning.sqlite" },
  destination,
) {
  if (typeof file !== "string" || path.basename(file) !== file || file.startsWith("."))
    throw new LearningError("invalid_input", "file must be a plain file name in the directory.")
  const root = path.resolve(directory)
  const target = path.join(root, file)
  assertPrivate(root)
  for (const name of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    const candidate = path.join(root, name)
    const info = lstatSync(candidate, { throwIfNoEntry: false })
    if (info) assertOwnPath(root, candidate, info)
  }
  let descriptor
  try {
    descriptor = openSync(target, constants.O_RDONLY | NO_FOLLOW)
  } catch (error) {
    if (error.code === "ENOENT")
      throw new LearningError("not_found", "The selected SQLite learning database is missing.")
    throw openError(root, target, error)
  }
  try {
    const checked = fstatSync(descriptor)
    assertPrivate(target)
    assertSameFile(root, target, checked)
    const db = new DatabaseSync(target, { readOnly: true })
    try {
      assertSameFile(root, target, checked)
      await backup(db, destination)
      assertSameFile(root, target, checked)
    } finally {
      db.close()
    }
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Stores learning records in one SQLite file with the driver built into Node.js 24, so it
 * needs no service and no dependency. It is the default provider.
 *
 * The file is <directory>/learning.sqlite, created owner-only (0700 directory, 0600 file).
 * The provider refuses that file, or one SQLite keeps beside it, when it is a link or has a
 * second name, because SQLite would follow it out of the directory.
 * Each row keeps a record's exact JSON, so digests still verify, with its scope, time, and
 * episode copied into indexed columns. Every write runs in a BEGIN IMMEDIATE transaction,
 * which locks out other writers, including other processes, until it ends, and a change and its
 * audit entries share one transaction. Write-ahead logging lets readers continue during a
 * write. Reading a store nobody wrote creates nothing.
 *
 * @param {{ directory: string, file?: string }} options
 */
export function createSqliteMemoryProvider({ directory, file = "learning.sqlite" } = {}) {
  if (typeof directory !== "string" || !directory)
    throw new LearningError("invalid_input", "The SQLite provider needs a directory.")
  if (typeof file !== "string" || path.basename(file) !== file || file.startsWith("."))
    throw new LearningError("invalid_input", "file must be a plain file name in the directory.")
  const root = path.resolve(directory)
  const target = path.join(root, file)
  let db = null
  let statements = null
  let migrating = false

  /**
   * Refuse the database, or a file SQLite keeps beside it, unless it is this provider's own.
   * SQLite follows links, so a link in their place would send reads and writes elsewhere.
   */
  function assertOwnFiles() {
    for (const name of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
      const candidate = path.join(root, name)
      const info = lstatSync(candidate, { throwIfNoEntry: false })
      if (info) assertOwnPath(root, candidate, info)
    }
  }

  /** The open database, or null when nobody wrote one and this call only reads. */
  function connect({ create }) {
    if (migrating)
      throw new LearningError("conflict", "This provider is migrating a repository scope.")
    if (db) return db
    if (existsSync(root)) assertOwnFiles()
    if (!create && !lstatSync(target, { throwIfNoEntry: false })) return null
    mkdirSync(root, { recursive: true, mode: 0o700 })
    assertPrivate(root)
    let checked
    try {
      const descriptor = openSync(target, constants.O_WRONLY | constants.O_CREAT | NO_FOLLOW, 0o600)
      try {
        checked = fstatSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
    } catch (error) {
      throw openError(root, target, error)
    }
    assertPrivate(target)
    // node:sqlite opens the path again by name and follows links, so check that it opened the
    // file checked above, and that the files SQLite keeps beside it are this provider's own.
    const opened = new DatabaseSync(target)
    try {
      assertSameFile(root, target, checked)
      opened.exec(SCHEMA)
      assertOwnFiles()
    } catch (error) {
      opened.close()
      throw error
    }
    db = opened
    statements = {
      insertRecord: db.prepare(`
        insert into records (stream, id, scope_key, occurred_at, episode_id, digest, body)
        values (?, ?, ?, ?, ?, ?, ?) on conflict (stream, id) do nothing`),
      storedDigest: db.prepare("select digest from records where stream = ? and id = ?"),
      snapshotCollections: db.prepare(`
        select id, digest from records
        where stream = 'collections' and scope_key = ?
        order by id`),
      storedEvent: db.prepare("select body from records where stream = 'events' and id = ?"),
      replaceEvent: db.prepare("update records set body = ? where stream = 'events' and id = ?"),
      latestVersion: db.prepare(
        "select version, digest from memory_versions where id = ? order by version desc limit 1",
      ),
      insertVersion: db.prepare(`
        insert into memory_versions (id, version, scope_key, updated_at, digest, body)
        values (?, ?, ?, ?, ?, ?)`),
    }
    return db
  }

  /** Run work in one write transaction, which also locks out other processes until it ends. */
  function transaction(work) {
    const database = connect({ create: true })
    database.exec("begin immediate")
    try {
      const result = work()
      database.exec("commit")
      return result
    } catch (error) {
      database.exec("rollback")
      throw error
    }
  }

  /** Insert records into a stream inside a transaction, skipping those already stored. */
  function insert(stream, records) {
    let appended = 0
    let existing = 0
    for (const record of records) {
      const { changes } = statements.insertRecord.run(
        stream,
        record.id,
        canonicalJson(record.scope),
        text(record[STREAMS[stream]]),
        text(stream === "episodes" ? record.id : record.episodeId),
        record.digest,
        JSON.stringify(record),
      )
      if (changes) {
        appended++
        continue
      }
      if (statements.storedDigest.get(stream, record.id)?.digest !== record.digest)
        throw new ProviderConflictError(
          `${stream} already holds a different record with ID ${record.id}.`,
          { stream, id: record.id },
        )
      existing++
    }
    return { appended, existing }
  }

  function assertMigrations(expectedMigrations) {
    if (expectedMigrations) {
      const table = db
        .prepare("select 1 from sqlite_master where type = 'table' and name = 'scope_migrations'")
        .get()
      const migrations = table
        ? db
            .prepare("select metadata from scope_migrations where new_scope_key = ? order by rowid")
            .all(canonicalJson(expectedMigrations.scope))
            .map((row) => JSON.parse(row.metadata))
        : []
      if (digestOf(migrations) !== expectedMigrations.digest)
        throw new ProviderConflictError("Repository migration changed during the write.")
    }
  }

  /** Append to several streams in one transaction. */
  function write(batch, { audit = [], expectedCollection, expectedMigrations } = {}) {
    const writes = batchWrites(batch, audit)
    return transaction(() => {
      assertMigrations(expectedMigrations)
      if (expectedCollection) {
        const actual = statements.snapshotCollections
          .all(canonicalJson(expectedCollection.scope))
          .map(({ id, digest }) => ({ id, digest }))
        if (canonicalJson(actual) !== canonicalJson(expectedCollection.records))
          throw new ProviderConflictError("The snapshot changed during import.")
      }
      const counts = {}
      for (const [stream, records] of writes) {
        const result = insert(stream, records)
        if (Object.hasOwn(batch, stream)) counts[stream] = result
      }
      return counts
    })
  }

  function storedRecord(row) {
    try {
      if (!Object.hasOwn(STREAMS, row.stream)) throw new Error()
      const record = JSON.parse(row.body)
      if (
        row.id === record.id &&
        row.scope_key === canonicalJson(record.scope) &&
        row.digest === record.digest &&
        row.occurred_at === text(record[STREAMS[row.stream]]) &&
        row.episode_id === text(row.stream === "episodes" ? record.id : record.episodeId)
      )
        return record
    } catch {
      throw new LearningError("storage_corrupt", "SQLite store has an invalid record row.")
    }
    throw new LearningError("storage_corrupt", "SQLite store has an inconsistent record row.")
  }

  function storedMemory(row) {
    try {
      const record = JSON.parse(row.body)
      if (
        row.id === record.id &&
        row.version === record.version &&
        row.scope_key === canonicalJson(record.scope) &&
        row.digest === record.digest &&
        row.updated_at === text(record.updatedAt)
      )
        return record
    } catch {
      throw new LearningError("storage_corrupt", "SQLite store has an invalid memory row.")
    }
    throw new LearningError("storage_corrupt", "SQLite store has an inconsistent memory row.")
  }

  function storedScopes() {
    const database = connect({ create: false })
    if (!database) return []
    function parseScopeKey(key) {
      try {
        const scope = JSON.parse(key)
        if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error()
        if (canonicalJson(scope) === key) return scope
      } catch {
        throw new LearningError("storage_corrupt", "SQLite store has an invalid scope key.")
      }
      throw new LearningError("storage_corrupt", "SQLite store has a noncanonical scope key.")
    }
    const scopes = new Map()
    for (const row of database
      .prepare("select stream, id, scope_key, occurred_at, episode_id, digest, body from records")
      .iterate()) {
      storedRecord(row)
      if (!scopes.has(row.scope_key)) scopes.set(row.scope_key, parseScopeKey(row.scope_key))
    }
    for (const row of database
      .prepare("select id, version, scope_key, updated_at, digest, body from memory_versions")
      .iterate()) {
      storedMemory(row)
      if (!scopes.has(row.scope_key)) scopes.set(row.scope_key, parseScopeKey(row.scope_key))
    }
    if (
      database
        .prepare("select 1 from sqlite_master where type = 'table' and name = 'scope_migrations'")
        .get()
    ) {
      for (const row of database
        .prepare("select old_scope_key, new_scope_key, metadata from scope_migrations")
        .all()) {
        parseScopeKey(row.old_scope_key)
        const target = parseScopeKey(row.new_scope_key)
        try {
          const metadata = JSON.parse(row.metadata)
          if (
            canonicalJson(metadata.oldScope) !== row.old_scope_key ||
            canonicalJson(metadata.newScope) !== row.new_scope_key
          )
            throw new Error()
        } catch {
          throw new LearningError("storage_corrupt", "SQLite store has an invalid scope mapping.")
        }
        scopes.set(row.new_scope_key, target)
      }
    }
    return [...scopes.values()]
  }

  return {
    atomicMigrationRedactions: true,
    atomicMigrationFence: true,
    atomicCollectionImport: true,

    manifest() {
      return {
        schemaVersion: SCHEMA_VERSIONS.providerManifest,
        id: "sqlite",
        name: "SQLite file",
        version: PRODUCER.version,
        contract: { name: PROVIDER_CONTRACT.name, versions: [PROVIDER_CONTRACT.version] },
        capabilities: [...REQUIRED_CAPABILITIES, REDACT_CAPABILITY],
        storage: { kind: "local", location: target },
        externalCalls: [],
        dataRetention:
          "Records stay in the file until someone deletes it. Nothing leaves the machine. Redaction overwrites removed text in the file, but backups and copies keep their own.",
      }
    },

    async health() {
      try {
        const missing = { ok: true, detail: `Not created yet; the first write creates ${target}.` }
        if (!existsSync(root)) return missing
        assertPrivate(root)
        assertOwnFiles()
        if (!existsSync(target)) return missing
        assertPrivate(target)
        const { version } = connect({ create: false })
          .prepare("select sqlite_version() as version")
          .get()
        return { ok: true, detail: `SQLite ${version} at ${target}` }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    async appendRecords(stream, records, options) {
      assertStream(stream)
      return write({ [stream]: records }, options)[stream]
    },

    async appendBatch(batch, options) {
      return write(batch, options)
    },

    async readRecords(stream, query) {
      assertStream(stream)
      assertQuery(query)
      const database = connect({ create: false })
      if (!database) return []
      return select(database, query, {
        table: "records",
        stream,
        time: "occurred_at",
        episode: "episode_id",
      })
    },

    async appendMemoryVersion(
      record,
      { expectedPreviousDigest = null, audit = [], expectedMigrations } = {},
    ) {
      assertStorable([record])
      assertStorable(audit)
      if (!Number.isSafeInteger(record.version) || record.version < 1)
        throw new LearningError("invalid_input", "A memory version needs a positive version.")
      try {
        transaction(() => {
          assertMigrations(expectedMigrations)
          const latest = statements.latestVersion.get(record.id)
          if ((latest?.digest ?? null) !== expectedPreviousDigest)
            throw new ProviderConflictError(`Memory ${record.id} changed since it was read.`, {
              id: record.id,
            })
          if (record.version !== (latest?.version ?? 0) + 1)
            throw new ProviderConflictError(
              `Memory ${record.id} version must follow ${latest?.version ?? 0}.`,
              { id: record.id },
            )
          statements.insertVersion.run(
            record.id,
            record.version,
            canonicalJson(record.scope),
            text(record.updatedAt),
            record.digest,
            JSON.stringify(record),
          )
          insert("audit", audit)
        })
      } catch (error) {
        if (/UNIQUE constraint failed/.test(error.message))
          throw new ProviderConflictError(`Memory ${record.id} changed since it was read.`, {
            id: record.id,
          })
        throw error
      }
    },

    async readMemoryVersions(query) {
      assertQuery(query)
      const database = connect({ create: false })
      if (!database) return []
      return select(database, query, { table: "memory_versions", time: "updated_at" })
    },

    async legacyScopes() {
      return storedScopes().filter(
        (scope) =>
          scope.host === "github.com" &&
          typeof scope.repository === "string" &&
          !/^repositories\/[1-9][0-9]*$/.test(scope.repository),
      )
    },

    async storedScopes() {
      return storedScopes()
    },

    async scopeMigrations(scope) {
      const database = connect({ create: false })
      if (
        !database ||
        !database
          .prepare("select 1 from sqlite_master where type = 'table' and name = 'scope_migrations'")
          .get()
      )
        return []
      return database
        .prepare("select metadata from scope_migrations where new_scope_key = ? order by rowid")
        .all(canonicalJson(scope))
        .map((row) => JSON.parse(row.metadata))
    },

    async scopeMigrationFrom(scope) {
      const database = connect({ create: false })
      if (
        !database ||
        !database
          .prepare("select 1 from sqlite_master where type = 'table' and name = 'scope_migrations'")
          .get()
      )
        return null
      const row = database
        .prepare("select metadata from scope_migrations where old_scope_key = ?")
        .get(canonicalJson(scope))
      return row ? JSON.parse(row.metadata) : null
    },

    /**
     * Replace one event with its redacted copy. secure_delete overwrites the old text in the
     * database pages, and the checkpoint empties the write-ahead log, unless a reader in another
     * process holds those pages, in which case the next checkpoint does.
     */
    async redactRecord(stream, record) {
      if (stream !== "events")
        throw new LearningError("invalid_input", "Only events can be redacted.")
      const result = transaction(() => {
        const row = statements.storedEvent.get(record?.id)
        const stored = row ? JSON.parse(row.body) : undefined
        const problem = redactionProblem(stored, record)
        if (problem) throw problem
        if (stored.payload === undefined) return { redacted: false }
        statements.replaceEvent.run(JSON.stringify(record), record.id)
        return { redacted: true }
      })
      if (result.redacted) db.exec("pragma wal_checkpoint(truncate)")
      return result
    },

    /**
     * migrateScope({ oldScope, newScope, transform }) locks both scopes, passes their source
     * rows to async transform({ records, memories }), then atomically stores its returned
     * { records, memories, metadata }. Retrying returns the same metadata. A durable trigger
     * refuses later writes to the old scope, including writes from older provider processes.
     */
    async migrateScope({ oldScope, newScope, transform, sourceSnapshot }) {
      const database = connect({ create: true })
      assertPrivate(root)
      assertPrivate(target)
      assertOwnFiles()
      const oldKey = canonicalJson(oldScope)
      const newKey = canonicalJson(newScope)
      migrating = true
      let started = false
      try {
        database.exec("begin immediate")
        started = true
        database.exec(`
          create table if not exists scope_migrations (
            old_scope_key text primary key,
            new_scope_key text not null,
            metadata text not null
          );
          create index if not exists scope_migrations_by_target
            on scope_migrations (new_scope_key);
          create trigger if not exists migrated_records_insert before insert on records
          when exists (select 1 from scope_migrations where old_scope_key = new.scope_key)
          begin select raise(abort, 'repository scope has migrated'); end;
          create trigger if not exists migrated_records_update before update on records
          when exists (select 1 from scope_migrations where old_scope_key = old.scope_key
                       or old_scope_key = new.scope_key)
          begin select raise(abort, 'repository scope has migrated'); end;
          create trigger if not exists migrated_memories_insert before insert on memory_versions
          when exists (select 1 from scope_migrations where old_scope_key = new.scope_key)
          begin select raise(abort, 'repository scope has migrated'); end;
          create trigger if not exists migrated_memories_update before update on memory_versions
          when exists (select 1 from scope_migrations where old_scope_key = old.scope_key
                       or old_scope_key = new.scope_key)
          begin select raise(abort, 'repository scope has migrated'); end;
        `)
        const previous = database
          .prepare("select new_scope_key, metadata from scope_migrations where old_scope_key = ?")
          .get(oldKey)
        if (previous) {
          if (previous.new_scope_key !== newKey)
            throw new LearningError("conflict", "The old scope was migrated to another repository.")
          const metadata = JSON.parse(previous.metadata)
          database.exec("commit")
          started = false
          return metadata
        }
        if (database.prepare("select 1 from scope_migrations where new_scope_key = ?").get(oldKey))
          throw new LearningError("conflict", "The source scope is already a migration target.")
        const used = database
          .prepare(
            `
            select 1 from records where scope_key = ?
            union all select 1 from memory_versions where scope_key = ?
            union all select 1 from scope_migrations where old_scope_key = ? or new_scope_key = ?
            limit 1`,
          )
          .get(newKey, newKey, newKey, newKey)
        const knownTarget = database
          .prepare("select 1 from scope_migrations where new_scope_key = ?")
          .get(newKey)
        if (used && !knownTarget)
          throw new LearningError("conflict", "The target repository scope is already in use.")
        if (sourceSnapshot) {
          const existingSource = database
            .prepare(
              "select 1 from records where scope_key = ? union all select 1 from memory_versions where scope_key = ? limit 1",
            )
            .get(oldKey, oldKey)
          if (existingSource)
            throw new LearningError("conflict", "The old scope already exists in the target store.")
          for (const [stream, items] of Object.entries(sourceSnapshot.records)) {
            assertStream(stream)
            assertStorable(items)
            if (items.some((item) => canonicalJson(item.scope) !== oldKey))
              throw new LearningError("storage_corrupt", "The source contains another scope.")
            insert(stream, items)
          }
          assertStorable(sourceSnapshot.memories)
          for (const record of sourceSnapshot.memories) {
            if (canonicalJson(record.scope) !== oldKey)
              throw new LearningError("storage_corrupt", "The source contains another scope.")
            const latest = statements.latestVersion.get(record.id)
            if (
              (latest?.digest ?? null) !== (record.previousDigest ?? null) ||
              record.version !== (latest?.version ?? 0) + 1
            )
              throw new ProviderConflictError(`Memory ${record.id} conflicts with the target.`, {
                id: record.id,
              })
            statements.insertVersion.run(
              record.id,
              record.version,
              oldKey,
              text(record.updatedAt),
              record.digest,
              JSON.stringify(record),
            )
          }
        }
        const rows = database
          .prepare(
            "select seq, stream, id, scope_key, occurred_at, episode_id, digest, body from records where scope_key = ? order by seq",
          )
          .all(oldKey)
        const versions = database
          .prepare(
            "select seq, id, version, scope_key, updated_at, digest, body from memory_versions where scope_key = ? order by seq",
          )
          .all(oldKey)
        const otherVersions = database.prepare(
          "select 1 from memory_versions where id = ? and scope_key != ? limit 1",
        )
        for (const id of new Set(versions.map((row) => row.id)))
          if (otherVersions.get(id, oldKey))
            throw new LearningError("storage_corrupt", `Memory ${id} spans repository scopes.`)
        const records = Object.fromEntries(Object.keys(STREAMS).map((stream) => [stream, []]))
        for (const row of rows) {
          const record = storedRecord(row)
          records[row.stream].push(record)
        }
        const memories = versions.map(storedMemory)
        const targetRecords = Object.fromEntries(Object.keys(STREAMS).map((stream) => [stream, []]))
        for (const row of database
          .prepare("select stream, body from records where scope_key = ? order by seq")
          .all(newKey)) {
          if (!Object.hasOwn(targetRecords, row.stream))
            throw new LearningError("storage_corrupt", `Unknown stored stream ${row.stream}.`)
          targetRecords[row.stream].push(JSON.parse(row.body))
        }
        const targetMemories = database
          .prepare("select body from memory_versions where scope_key = ? order by seq")
          .all(newKey)
          .map((row) => JSON.parse(row.body))
        const result = await transform({ records, memories, targetRecords, targetMemories })
        const offsets = Object.fromEntries(Object.keys(STREAMS).map((stream) => [stream, 0]))
        const updateRecord = database.prepare(
          "update records set scope_key = ?, digest = ?, body = ? where seq = ?",
        )
        for (const row of rows) {
          const record = result.records[row.stream][offsets[row.stream]++]
          if (!record || record.id !== row.id || canonicalJson(record.scope) !== newKey)
            throw new LearningError("storage_corrupt", "Migration changed a record identity.")
          updateRecord.run(newKey, record.digest, JSON.stringify(record), row.seq)
        }
        const updateMemory = database.prepare(
          "update memory_versions set scope_key = ?, digest = ?, body = ? where seq = ?",
        )
        for (const [index, row] of versions.entries()) {
          const record = result.memories[index]
          if (
            !record ||
            record.id !== row.id ||
            record.version !== row.version ||
            canonicalJson(record.scope) !== newKey
          )
            throw new LearningError("storage_corrupt", "Migration changed a memory identity.")
          updateMemory.run(newKey, record.digest, JSON.stringify(record), row.seq)
        }
        for (const redacted of result.targetRedactions ?? []) {
          const row = database
            .prepare(
              "select body from records where stream = 'events' and id = ? and scope_key = ?",
            )
            .get(redacted.id, newKey)
          const stored = row ? JSON.parse(row.body) : undefined
          const problem = redactionProblem(stored, redacted)
          if (problem) throw problem
          statements.replaceEvent.run(JSON.stringify(redacted), redacted.id)
        }
        insert("audit", result.audit ?? [])
        database
          .prepare(
            "insert into scope_migrations (old_scope_key, new_scope_key, metadata) values (?, ?, ?)",
          )
          .run(oldKey, newKey, JSON.stringify(result.metadata))
        database.exec("commit")
        started = false
        if (result.targetRedactions?.length || result.audit?.length)
          database.exec("pragma wal_checkpoint(truncate)")
        return result.metadata
      } catch (error) {
        if (started) database.exec("rollback")
        throw error
      } finally {
        migrating = false
      }
    },

    async close() {
      if (migrating)
        throw new LearningError("conflict", "This provider is migrating a repository scope.")
      db?.close()
      db = null
      statements = null
    },
  }
}

/**
 * Records in one table that match the contract's filters exactly: the same scope, any of the
 * IDs, any of the episodes or audit operations, since inclusive and until exclusive, in the
 * order appended. Times are UTC text with six fractional digits, so text order is time order.
 */
function select(db, query, { table, stream, time, episode }) {
  const values = []
  const conditions = []
  function add(sql, value) {
    conditions.push(sql)
    values.push(value)
  }
  if (stream) add("stream = ?", stream)
  add("scope_key = ?", canonicalJson(query.scope))
  if (query.ids) add("id in (select value from json_each(?))", JSON.stringify(query.ids))
  if (query.operations?.length === 1)
    add("json_extract(body, '$.operation') = ?", query.operations[0])
  else if (query.operations)
    add(
      "json_extract(body, '$.operation') in (select value from json_each(?))",
      JSON.stringify(query.operations),
    )
  if (query.episodeIds) {
    if (!episode) return []
    add(`${episode} in (select value from json_each(?))`, JSON.stringify(query.episodeIds))
  }
  if (query.since) add(`${time} >= ?`, query.since)
  if (query.until) add(`${time} < ?`, query.until)
  return db
    .prepare(`select body from ${table} where ${conditions.join(" and ")} order by seq`)
    .all(...values)
    .map((row) => JSON.parse(row.body))
}

function text(value) {
  return typeof value === "string" ? value : null
}

function assertPrivate(target) {
  if (process.platform === "win32") return
  if ((statSync(target).mode & 0o077) !== 0)
    throw new LearningError(
      "storage_corrupt",
      `${target} is readable by other users. Run chmod ${statSync(target).isDirectory() ? 700 : 600} on it.`,
    )
}
