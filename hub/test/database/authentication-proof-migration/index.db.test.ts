import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("authentication proof migration", () => {
  it("upgrades the exact C2 schema before deploying Hub admission and sessions", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_upgrade_${randomBytes(8).toString("hex")}`
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
      const databaseUrl = new URL(adminUrl)
      databaseUrl.pathname = name
      const database = new pg.Client({ connectionString: databaseUrl.toString() })
      await database.connect()
      try {
        const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
        const c1MigrationName = "20261029203000_identity_foundation"
        const c2MigrationName = "20261030170000_authentication_proof"
        for (const migrationName of [c1MigrationName, c2MigrationName]) {
          const migrationPath = join(hubRoot, "schema/migrations", migrationName, "migration.sql")
          await database.query(await readFile(migrationPath, "utf8"))
        }

        const providerId = "00000000-0000-4000-8000-000000000010"
        const revisionId = "00000000-0000-4000-8000-000000000011"
        const userId = "00000000-0000-4000-8000-000000000012"
        const externalIdentityId = "00000000-0000-4000-8000-000000000015"
        await database.query("BEGIN")
        await database.query(
          `INSERT INTO authentication_providers (id, key) VALUES ($1, 'github')`,
          [providerId],
        )
        await database.query(
          `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest)
           VALUES ($1, $2, 1, $3)`,
          [revisionId, providerId, "a".repeat(64)],
        )
        await database.query(
          `UPDATE authentication_providers SET selected_revision_id = $1 WHERE id = $2`,
          [revisionId, providerId],
        )
        await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
        await database.query(
          `INSERT INTO external_identities
             (id, user_id, provider, issuer, subject)
           VALUES ($1, $2, 'github', 'https://github.com', '123456')`,
          [externalIdentityId, userId],
        )
        await database.query("COMMIT")
        const existingAttemptId = "00000000-0000-4000-8000-000000000013"
        await database.query(
          `INSERT INTO authorization_attempts
             (id, provider_revision_id, state_digest, browser_binding_digest,
              code_verifier_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4, 'encrypted', CURRENT_TIMESTAMP + interval '1 minute')`,
          [existingAttemptId, revisionId, "c".repeat(64), "d".repeat(64)],
        )
        const c2Records = await database.query(
          `SELECT
             provider.id AS provider_id,
             provider.key AS provider_key,
             provider.selected_revision_id,
             provider.created_at AS provider_created_at,
             provider.updated_at AS provider_updated_at,
             revision.id AS revision_id,
             revision.revision,
             revision.configuration_digest,
             revision.created_at AS revision_created_at,
             revision.updated_at AS revision_updated_at,
             hub_user.id AS user_id,
             hub_user.created_at AS user_created_at,
             hub_user.updated_at AS user_updated_at,
             identity.id AS external_identity_id,
             identity.provider AS identity_provider,
             identity.issuer,
             identity.subject,
             identity.created_at AS identity_created_at,
             identity.updated_at AS identity_updated_at
           FROM authentication_providers provider
           JOIN authentication_provider_revisions revision
             ON revision.id = provider.selected_revision_id
           JOIN users hub_user ON hub_user.id = $1
           JOIN external_identities identity ON identity.user_id = hub_user.id
           WHERE provider.id = $2`,
          [userId, providerId],
        )
        const prisma = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        for (const migrationName of [c1MigrationName, c2MigrationName]) {
          await promisify(execFile)(
            process.execPath,
            [
              prisma,
              "migrate",
              "resolve",
              "--applied",
              migrationName,
              "--config",
              join(hubRoot, "prisma7.config.ts"),
            ],
            options,
          )
        }
        await promisify(execFile)(
          process.execPath,
          [prisma, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
          options,
        )

        const migrations = await database.query<{ migration_name: string }>(
          "SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at",
        )
        expect(migrations.rows).toEqual([
          { migration_name: "20261029203000_identity_foundation" },
          { migration_name: "20261030170000_authentication_proof" },
          { migration_name: "20261102130000_hub_admission_sessions" },
        ])
        const c2Tables = await database.query<{ table_name: string }>(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = 'authorization_attempts'
           ORDER BY table_name`,
        )
        expect(c2Tables.rows).toEqual([{ table_name: "authorization_attempts" }])
        const attemptColumns = await database.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'authorization_attempts'
           ORDER BY ordinal_position`,
        )
        expect(attemptColumns.rows.map(({ column_name }) => column_name)).toEqual([
          "id",
          "provider_revision_id",
          "state_digest",
          "browser_binding_digest",
          "code_verifier_ciphertext",
          "expires_at",
          "consumed_at",
          "created_at",
          "updated_at",
          "purpose",
        ])
        const attemptIndexes = await database.query<{ indexname: string }>(
          `SELECT indexname
           FROM pg_indexes
           WHERE schemaname = 'public'
             AND tablename = 'authorization_attempts'
           ORDER BY indexname`,
        )
        expect(attemptIndexes.rows.map(({ indexname }) => indexname)).toEqual([
          "authorization_attempts_consumed_at_idx",
          "authorization_attempts_expires_at_idx",
          "authorization_attempts_pkey",
          "authorization_attempts_state_digest_key",
        ])
        const upgradedRecords = await database.query(
          `SELECT
             provider.id AS provider_id,
             provider.key AS provider_key,
             provider.selected_revision_id,
             provider.created_at AS provider_created_at,
             provider.updated_at AS provider_updated_at,
             revision.id AS revision_id,
             revision.revision,
             revision.configuration_digest,
             revision.created_at AS revision_created_at,
             revision.updated_at AS revision_updated_at,
             hub_user.id AS user_id,
             hub_user.created_at AS user_created_at,
             hub_user.updated_at AS user_updated_at,
             identity.id AS external_identity_id,
             identity.provider AS identity_provider,
             identity.issuer,
             identity.subject,
             identity.created_at AS identity_created_at,
             identity.updated_at AS identity_updated_at
           FROM authentication_providers provider
           JOIN authentication_provider_revisions revision
             ON revision.id = provider.selected_revision_id
           JOIN users hub_user ON hub_user.id = $1
           JOIN external_identities identity ON identity.user_id = hub_user.id
           WHERE provider.id = $2`,
          [userId, providerId],
        )
        expect(upgradedRecords.rows).toEqual(c2Records.rows)
        await expect(
          database.query(`SELECT purpose::text FROM authorization_attempts WHERE id = $1`, [
            existingAttemptId,
          ]),
        ).resolves.toMatchObject({ rows: [{ purpose: "SIGN_IN" }] })

        const attemptId = "00000000-0000-4000-8000-000000000014"
        await expect(
          database.query(
            `INSERT INTO authorization_attempts
               (id, provider_revision_id, state_digest, browser_binding_digest,
                purpose, code_verifier_ciphertext, expires_at)
             VALUES ($1, $2, 'bad', $3, 'SIGN_IN', 'encrypted',
               CURRENT_TIMESTAMP + interval '1 minute')`,
            [attemptId, revisionId, "b".repeat(64)],
          ),
        ).rejects.toThrow()
        await database.query(
          `INSERT INTO authorization_attempts
             (id, provider_revision_id, state_digest, browser_binding_digest,
              purpose, code_verifier_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4, 'ADMIN_ENROLLMENT', 'encrypted',
             CURRENT_TIMESTAMP + interval '1 minute')`,
          [attemptId, revisionId, "a".repeat(64), "b".repeat(64)],
        )
        await expect(
          database.query(`DELETE FROM authorization_attempts WHERE id = $1`, [attemptId]),
        ).rejects.toThrow("Unexpired authorization attempts cannot be deleted")
        await database.query(
          `UPDATE authorization_attempts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [attemptId],
        )
        await expect(
          database.query(`UPDATE authorization_attempts SET purpose = 'SIGN_IN' WHERE id = $1`, [
            attemptId,
          ]),
        ).rejects.toThrow("immutable")
        await expect(
          database.query(
            `UPDATE authorization_attempts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [attemptId],
          ),
        ).rejects.toThrow("first consumption")

        const userId = "00000000-0000-4000-8000-000000000020"
        const otherUserId = "00000000-0000-4000-8000-000000000021"
        const identityId = "00000000-0000-4000-8000-000000000022"
        const otherIdentityId = "00000000-0000-4000-8000-000000000023"
        const membershipId = "00000000-0000-4000-8000-000000000024"
        const otherMembershipId = "00000000-0000-4000-8000-000000000025"
        const assignmentId = "00000000-0000-4000-8000-000000000026"
        await database.query(`INSERT INTO users (id) VALUES ($1), ($2)`, [userId, otherUserId])
        await database.query(
          `INSERT INTO external_identities
             (id, user_id, provider, issuer, subject)
           VALUES
             ($1, $2, 'github', 'https://github.com', '20'),
             ($3, $4, 'github', 'https://github.com', '21')`,
          [identityId, userId, otherIdentityId, otherUserId],
        )
        await database.query(
          `INSERT INTO memberships (id, user_id)
           VALUES ($1, $2), ($3, $4)`,
          [membershipId, userId, otherMembershipId, otherUserId],
        )
        await database.query(
          `INSERT INTO membership_assignments
             (id, membership_id, external_identity_id, source, role)
           VALUES ($1, $2, $3, 'BOOTSTRAP', 'ADMINISTRATOR')`,
          [assignmentId, membershipId, identityId],
        )
        await expect(
          database.query(
            `INSERT INTO membership_assignments
               (id, membership_id, external_identity_id, source, role)
             VALUES (gen_random_uuid(), $1, $2, 'BOOTSTRAP', 'ADMINISTRATOR')`,
            [otherMembershipId, identityId],
          ),
        ).rejects.toThrow("must belong to the membership user")
        for (const statement of [
          `UPDATE membership_assignments SET membership_id = '${otherMembershipId}' WHERE id = '${assignmentId}'`,
          `UPDATE membership_assignments SET external_identity_id = '${otherIdentityId}' WHERE id = '${assignmentId}'`,
          `UPDATE membership_assignments SET created_at = clock_timestamp() WHERE id = '${assignmentId}'`,
          `DELETE FROM membership_assignments WHERE id = '${assignmentId}'`,
        ]) {
          await expect(database.query(statement)).rejects.toThrow()
        }
        await expect(
          database.query(`UPDATE membership_assignments SET role = 'MEMBER' WHERE id = $1`, [
            assignmentId,
          ]),
        ).rejects.toThrow()
        await expect(
          database.query(`UPDATE membership_assignments SET source = 'PROVIDER' WHERE id = $1`, [
            assignmentId,
          ]),
        ).rejects.toThrow()
        await database.query(
          `UPDATE membership_assignments SET lifecycle = 'REVOKED' WHERE id = $1`,
          [assignmentId],
        )
        await database.query(
          `UPDATE membership_assignments SET lifecycle = 'ACTIVE' WHERE id = $1`,
          [assignmentId],
        )

        const revocation = await database.query<{ key: string; revision: number }>(
          `SELECT key, revision FROM session_revocation_states`,
        )
        expect(revocation.rows).toEqual([{ key: "global", revision: 0 }])
        await expect(
          database.query(
            `INSERT INTO session_revocation_states
               (id, key, revision, created_at, updated_at)
             VALUES (gen_random_uuid(), 'extra', 0, clock_timestamp(), clock_timestamp())`,
          ),
        ).rejects.toThrow()
        await expect(
          database.query(
            `INSERT INTO session_revocation_states
               (id, key, revision, created_at, updated_at)
             VALUES (gen_random_uuid(), 'global', 0, clock_timestamp(), clock_timestamp())`,
          ),
        ).rejects.toThrow()
        for (const statement of [
          `DELETE FROM session_revocation_states WHERE key = 'global'`,
          `UPDATE session_revocation_states SET key = 'replacement', revision = 1, updated_at = clock_timestamp() WHERE key = 'global'`,
          `UPDATE session_revocation_states SET id = gen_random_uuid(), revision = 1, updated_at = clock_timestamp() WHERE key = 'global'`,
          `UPDATE session_revocation_states SET created_at = clock_timestamp(), revision = 1, updated_at = clock_timestamp() WHERE key = 'global'`,
          `UPDATE session_revocation_states SET revision = 2, updated_at = clock_timestamp() WHERE key = 'global'`,
        ]) {
          await expect(database.query(statement)).rejects.toThrow()
        }
        await database.query(
          `UPDATE session_revocation_states
           SET revision = revision + 1, updated_at = clock_timestamp()
           WHERE key = 'global'`,
        )
        await expect(
          database.query(
            `UPDATE session_revocation_states
             SET revision = 0, updated_at = clock_timestamp()
             WHERE key = 'global'`,
          ),
        ).rejects.toThrow("must increment exactly once")

        for (const statement of [
          `DELETE FROM memberships WHERE id = '${membershipId}'`,
          `UPDATE memberships SET user_id = '${otherUserId}', lifecycle = 'SUSPENDED', updated_at = clock_timestamp() WHERE id = '${membershipId}'`,
          `UPDATE memberships SET id = gen_random_uuid(), lifecycle = 'SUSPENDED', updated_at = clock_timestamp() WHERE id = '${membershipId}'`,
          `UPDATE memberships SET created_at = clock_timestamp(), lifecycle = 'SUSPENDED', updated_at = clock_timestamp() WHERE id = '${membershipId}'`,
          `UPDATE memberships SET updated_at = clock_timestamp() WHERE id = '${membershipId}'`,
        ]) {
          await expect(database.query(statement)).rejects.toThrow()
        }
        await database.query(
          `UPDATE memberships
           SET lifecycle = 'SUSPENDED', updated_at = clock_timestamp()
           WHERE id = $1`,
          [membershipId],
        )
        await expect(
          database.query(
            `INSERT INTO hub_sessions
               (id, user_id, membership_id, digest, revocation_revision, expires_at)
             VALUES (
               gen_random_uuid(), $1, $2, 'bad', 0,
               clock_timestamp() + interval '1 hour'
             )`,
            [userId, membershipId],
          ),
        ).rejects.toThrow()
        await expect(
          database.query(
            `INSERT INTO authentication_rate_limits
               (id, operation, subject_digest, window_started_at, count, expires_at)
             VALUES (
               gen_random_uuid(), 'start', $1, clock_timestamp(), 0,
               clock_timestamp() + interval '1 minute'
             )`,
            ["a".repeat(64)],
          ),
        ).rejects.toThrow()
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
