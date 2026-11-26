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
  {
    version: 2,
    sql: `
      create table replica_learning.scope_migrations (
        seq bigint generated always as identity primary key,
        old_scope_key text collate "C" not null unique,
        new_scope_key text collate "C" not null,
        metadata text not null
      );
      create index scope_migrations_by_target
        on replica_learning.scope_migrations (new_scope_key, seq);
      create table replica_learning.sqlite_imports (
        scope_key text collate "C" primary key,
        source_digest text not null
      );
    `,
  },
  {
    version: 3,
    sql: `
      create table replica_learning.decision_generations (
        scope_key text collate "C" primary key,
        generation bigint not null check (generation between 0 and 9007199254740991)
      );
      create index records_by_hub_thread on replica_learning.records (
        scope_key,
        ((body::jsonb -> 'source') -> 'hubOrigin'),
        ((body::jsonb -> 'source') -> 'repositoryId'),
        ((body::jsonb -> 'source') -> 'prototypeId'),
        ((body::jsonb -> 'source') -> 'threadId')
      ) where stream = 'episodes'
        and (body::jsonb -> 'source') ->> 'kind' = 'hub_review_comments';
      create index decision_collections_by_source on replica_learning.records (
        scope_key,
        (coalesce((body::jsonb -> 'source') -> 'hubOrigin', 'null'::jsonb)),
        (coalesce((body::jsonb -> 'source') -> 'repositoryId', 'null'::jsonb))
      ) where stream = 'collections' and (body::jsonb) ->> 'reviewerIdentity' = 'stable-user-id';
      create index decision_collections_by_snapshot on replica_learning.records
        (scope_key, ((body::jsonb) ->> 'snapshotId')) where stream = 'collections';
      create table replica_learning.decision_grant_sources (
        scope_key text collate "C" not null,
        source text collate "C" not null,
        purpose text collate "C" not null,
        grant_id text collate "C" not null,
        granted_at text collate "C" not null,
        expires_at text collate "C" not null,
        evidence_from text collate "C",
        evidence_until text collate "C",
        primary key (scope_key, source, purpose, grant_id)
      );
      create index decision_grant_sources_by_id
        on replica_learning.decision_grant_sources (scope_key, grant_id);
      create index decision_grant_sources_by_expiry
        on replica_learning.decision_grant_sources
          (scope_key, source, purpose, expires_at, granted_at);
      create index decision_grant_sources_by_start
        on replica_learning.decision_grant_sources
          (scope_key, source, purpose, granted_at, expires_at);
      -- Keep the original target when a stored withdrawal is damaged.
      create table replica_learning.decision_withdrawal_targets (
        scope_key text collate "C" not null,
        grant_id text collate "C" not null,
        withdrawal_id text collate "C" not null,
        primary key (scope_key, grant_id, withdrawal_id)
      );
      insert into replica_learning.decision_withdrawal_targets (scope_key, grant_id, withdrawal_id)
      select scope_key, (body::jsonb) ->> 'grantId', id from replica_learning.records
      where stream = 'withdrawals' and jsonb_typeof((body::jsonb) -> 'grantId') = 'string'
      on conflict do nothing;
      -- Audit entries also retain targets damaged before this index existed.
      insert into replica_learning.decision_withdrawal_targets (scope_key, grant_id, withdrawal_id)
      select audit.scope_key, grant_subject.value ->> 'id', withdrawal_subject.value ->> 'id'
      from replica_learning.records as audit
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(audit.body::jsonb -> 'subjects') = 'array'
          then audit.body::jsonb -> 'subjects' else '[]'::jsonb end
      ) as grant_subject(value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(audit.body::jsonb -> 'subjects') = 'array'
          then audit.body::jsonb -> 'subjects' else '[]'::jsonb end
      ) as withdrawal_subject(value)
      where audit.stream = 'audit' and audit.body::jsonb ->> 'operation' = 'grant.withdraw'
        and grant_subject.value ->> 'kind' = 'grant'
        and jsonb_typeof(grant_subject.value -> 'id') = 'string'
        and withdrawal_subject.value ->> 'kind' = 'withdrawal'
        and jsonb_typeof(withdrawal_subject.value -> 'id') = 'string'
      on conflict do nothing;
      create function replica_learning.index_decision_withdrawal_targets()
      returns trigger language plpgsql set search_path = pg_catalog, replica_learning as $$
      begin
        if tg_op <> 'INSERT' and old.stream = 'withdrawals'
          and jsonb_typeof((old.body::jsonb) -> 'grantId') = 'string' then
          insert into replica_learning.decision_withdrawal_targets (scope_key, grant_id, withdrawal_id)
          values (old.scope_key, (old.body::jsonb) ->> 'grantId', old.id)
          on conflict do nothing;
        end if;
        if tg_op <> 'DELETE' and new.stream = 'withdrawals'
          and jsonb_typeof((new.body::jsonb) -> 'grantId') = 'string' then
          insert into replica_learning.decision_withdrawal_targets (scope_key, grant_id, withdrawal_id)
          values (new.scope_key, (new.body::jsonb) ->> 'grantId', new.id)
          on conflict do nothing;
        end if;
        return null;
      end;
      $$;
      create trigger decision_withdrawal_targets_write
        after insert or update or delete on replica_learning.records
        for each row execute function replica_learning.index_decision_withdrawal_targets();
      insert into replica_learning.decision_grant_sources
        (scope_key, source, purpose, grant_id, granted_at, expires_at, evidence_from, evidence_until)
      select grant_record.scope_key, source.value #>> '{}', purpose.value #>> '{}', grant_record.id,
        coalesce((grant_record.body::jsonb) ->> 'grantedAt', '9999-12-31T23:59:59.999999Z'),
        coalesce((grant_record.body::jsonb) ->> 'expiresAt', '9999-12-31T23:59:59.999999Z'),
        (grant_record.body::jsonb) ->> 'evidenceFrom',
        (grant_record.body::jsonb) ->> 'evidenceUntil'
      from replica_learning.records as grant_record
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(grant_record.body::jsonb -> 'sources') = 'array'
          then grant_record.body::jsonb -> 'sources' else '[]'::jsonb end
      ) as source(value)
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(grant_record.body::jsonb -> 'purposes') = 'array'
          then grant_record.body::jsonb -> 'purposes' else '[]'::jsonb end
      ) as purpose(value)
      where grant_record.stream = 'grants'
        and jsonb_typeof(source.value) = 'string' and jsonb_typeof(purpose.value) = 'string'
      on conflict do nothing;
      create function replica_learning.index_decision_grant_sources()
      returns trigger language plpgsql set search_path = pg_catalog, replica_learning as $$
      begin
        if tg_op <> 'INSERT' and old.stream = 'grants' then
          delete from replica_learning.decision_grant_sources
          where scope_key = old.scope_key and grant_id = old.id;
        end if;
        if tg_op <> 'DELETE' and new.stream = 'grants' then
          insert into replica_learning.decision_grant_sources
            (scope_key, source, purpose, grant_id, granted_at, expires_at, evidence_from, evidence_until)
          select new.scope_key, source.value #>> '{}', purpose.value #>> '{}', new.id,
            coalesce((new.body::jsonb) ->> 'grantedAt', '9999-12-31T23:59:59.999999Z'),
            coalesce((new.body::jsonb) ->> 'expiresAt', '9999-12-31T23:59:59.999999Z'),
            (new.body::jsonb) ->> 'evidenceFrom', (new.body::jsonb) ->> 'evidenceUntil'
          from jsonb_array_elements(
            case when jsonb_typeof(new.body::jsonb -> 'sources') = 'array'
              then new.body::jsonb -> 'sources' else '[]'::jsonb end
          ) as source(value)
          cross join lateral jsonb_array_elements(
            case when jsonb_typeof(new.body::jsonb -> 'purposes') = 'array'
              then new.body::jsonb -> 'purposes' else '[]'::jsonb end
          ) as purpose(value)
          where jsonb_typeof(source.value) = 'string' and jsonb_typeof(purpose.value) = 'string'
          on conflict do nothing;
        end if;
        return null;
      end;
      $$;
      create trigger decision_grant_sources_write
        after insert or update or delete on replica_learning.records
        for each row execute function replica_learning.index_decision_grant_sources();
      create table replica_learning.decision_migration_origins (
        scope_key text collate "C" not null,
        kind text collate "C" not null,
        record_id text collate "C" not null,
        migration_id bigint not null,
        old_scope_key text collate "C" not null,
        primary key (scope_key, kind, record_id, migration_id)
      );
      create index decision_migration_origins_by_migration
        on replica_learning.decision_migration_origins (migration_id);
      insert into replica_learning.decision_migration_origins
        (scope_key, kind, record_id, migration_id, old_scope_key)
      select migration.new_scope_key, mapping.value ->> 'kind', mapping.value ->> 'id',
        migration.seq, migration.old_scope_key
      from replica_learning.scope_migrations as migration
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(migration.metadata::jsonb -> 'digestMappings') = 'array'
          then migration.metadata::jsonb -> 'digestMappings' else '[]'::jsonb end
      ) as mapping(value)
      where mapping.value ->> 'field' = 'digest'
        and mapping.value ->> 'kind' in ('grant', 'event')
        and jsonb_typeof(mapping.value -> 'id') = 'string'
      on conflict do nothing;
      create function replica_learning.index_decision_migration_origins()
      returns trigger language plpgsql set search_path = pg_catalog, replica_learning as $$
      begin
        if tg_op <> 'INSERT' then
          delete from replica_learning.decision_migration_origins where migration_id = old.seq;
        end if;
        if tg_op <> 'DELETE' then
          insert into replica_learning.decision_migration_origins
            (scope_key, kind, record_id, migration_id, old_scope_key)
          select new.new_scope_key, mapping.value ->> 'kind', mapping.value ->> 'id',
            new.seq, new.old_scope_key
          from jsonb_array_elements(
            case when jsonb_typeof(new.metadata::jsonb -> 'digestMappings') = 'array'
              then new.metadata::jsonb -> 'digestMappings' else '[]'::jsonb end
          ) as mapping(value)
          where mapping.value ->> 'field' = 'digest'
            and mapping.value ->> 'kind' in ('grant', 'event')
            and jsonb_typeof(mapping.value -> 'id') = 'string'
          on conflict do nothing;
        end if;
        return null;
      end;
      $$;
      create trigger decision_migration_origins_write
        after insert or update or delete on replica_learning.scope_migrations
        for each row execute function replica_learning.index_decision_migration_origins();
      create table replica_learning.decision_memory_targets (
        scope_key text collate "C" not null,
        source_id text collate "C" not null,
        version integer not null,
        target_id text collate "C" not null,
        primary key (scope_key, source_id, version, target_id)
      );
      create index decision_memory_targets_by_target
        on replica_learning.decision_memory_targets (scope_key, target_id, source_id);
      insert into replica_learning.decision_memory_targets
        (scope_key, source_id, version, target_id)
      select memory.scope_key, memory.id, memory.version, target.value #>> '{}'
      from replica_learning.memory_versions as memory
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(memory.body::jsonb -> 'supersedes') = 'array'
          then memory.body::jsonb -> 'supersedes' else '[]'::jsonb end
      ) as target(value)
      where jsonb_typeof(target.value) = 'string'
      on conflict do nothing;
      create function replica_learning.index_decision_memory_targets()
      returns trigger language plpgsql set search_path = pg_catalog, replica_learning as $$
      begin
        if tg_op <> 'INSERT' then
          delete from replica_learning.decision_memory_targets
          where scope_key = old.scope_key and source_id = old.id and version = old.version;
        end if;
        if tg_op <> 'DELETE' then
          insert into replica_learning.decision_memory_targets
            (scope_key, source_id, version, target_id)
          select new.scope_key, new.id, new.version, target.value #>> '{}'
          from jsonb_array_elements(
            case when jsonb_typeof(new.body::jsonb -> 'supersedes') = 'array'
              then new.body::jsonb -> 'supersedes' else '[]'::jsonb end
          ) as target(value)
          where jsonb_typeof(target.value) = 'string'
          on conflict do nothing;
        end if;
        return null;
      end;
      $$;
      create trigger decision_targets_write
        after insert or update or delete on replica_learning.memory_versions
        for each row execute function replica_learning.index_decision_memory_targets();
      create function replica_learning.advance_decision_generation()
      returns trigger language plpgsql set search_path = pg_catalog, replica_learning as $$
      begin
        if tg_table_name = 'records' then
          insert into replica_learning.decision_generations (scope_key, generation)
          select distinct scope_key, 1 from changed_rows
          where stream in ('grants', 'withdrawals', 'collections', 'episodes', 'events')
          on conflict (scope_key) do update
          set generation = replica_learning.decision_generations.generation + 1;
        elsif tg_table_name = 'scope_migrations' then
          insert into replica_learning.decision_generations (scope_key, generation)
          select scope_key, 1 from (
            select old_scope_key as scope_key from changed_rows
            union
            select new_scope_key as scope_key from changed_rows
          ) as scopes
          on conflict (scope_key) do update
          set generation = replica_learning.decision_generations.generation + 1;
        else
          insert into replica_learning.decision_generations (scope_key, generation)
          select distinct scope_key, 1 from changed_rows
          on conflict (scope_key) do update
          set generation = replica_learning.decision_generations.generation + 1;
        end if;
        return null;
      end;
      $$;
      create trigger decision_records_insert after insert on replica_learning.records
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_records_update_old after update on replica_learning.records
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_records_update_new after update on replica_learning.records
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_records_delete after delete on replica_learning.records
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_memories_insert after insert on replica_learning.memory_versions
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_memories_update_old after update on replica_learning.memory_versions
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_memories_update_new after update on replica_learning.memory_versions
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_memories_delete after delete on replica_learning.memory_versions
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_migrations_insert after insert on replica_learning.scope_migrations
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_migrations_update_old after update on replica_learning.scope_migrations
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_migrations_update_new after update on replica_learning.scope_migrations
        referencing new table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
      create trigger decision_migrations_delete after delete on replica_learning.scope_migrations
        referencing old table as changed_rows for each statement
        execute function replica_learning.advance_decision_generation();
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
