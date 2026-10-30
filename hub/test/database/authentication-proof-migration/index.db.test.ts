import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("authentication proof migration", () => {
  it("upgrades the exact C1 schema before deploying C2", async () => {
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
        const migrationName = "20261029203000_identity_foundation"
        const migrationPath = join(hubRoot, "schema/migrations", migrationName, "migration.sql")
        await database.query(await readFile(migrationPath, "utf8"))
        const prisma = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        await promisify(execFile)(
          process.execPath,
          [prisma, "migrate", "resolve", "--applied", migrationName],
          options,
        )
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
        ])
        const handoff = await database.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admission_handoffs'",
        )
        expect(handoff.rows).toEqual([{ table_name: "admission_handoffs" }])

        const providerId = "00000000-0000-4000-8000-000000000010"
        const revisionId = "00000000-0000-4000-8000-000000000011"
        const userId = "00000000-0000-4000-8000-000000000012"
        const identityId = "00000000-0000-4000-8000-000000000013"
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
           VALUES ($1, $2, 'github', 'https://github.com', '123')`,
          [identityId, userId],
        )
        await database.query("COMMIT")

        const attemptId = "00000000-0000-4000-8000-000000000014"
        await expect(
          database.query(
            `INSERT INTO authorization_attempts
               (id, provider_revision_id, state_digest, browser_binding_digest,
                code_challenge, code_verifier_ciphertext, request_ip_digest, expires_at)
             VALUES ($1, $2, 'bad', $3, $4, 'encrypted', $5, CURRENT_TIMESTAMP + interval '1 minute')`,
            [attemptId, revisionId, "b".repeat(64), "c".repeat(43), "d".repeat(64)],
          ),
        ).rejects.toThrow()
        await database.query(
          `INSERT INTO authorization_attempts
             (id, provider_revision_id, state_digest, browser_binding_digest,
              code_challenge, code_verifier_ciphertext, request_ip_digest, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'encrypted', $6, CURRENT_TIMESTAMP + interval '1 minute')`,
          [attemptId, revisionId, "a".repeat(64), "b".repeat(64), "c".repeat(43), "d".repeat(64)],
        )
        await expect(
          database.query(`DELETE FROM authorization_attempts WHERE id = $1`, [attemptId]),
        ).rejects.toThrow("Unexpired authorization attempts cannot be deleted")
        await database.query(
          `UPDATE authorization_attempts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [attemptId],
        )
        await expect(
          database.query(
            `UPDATE authorization_attempts SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [attemptId],
          ),
        ).rejects.toThrow("first consumption")

        const handoffId = "00000000-0000-4000-8000-000000000015"
        await expect(
          database.query(
            `INSERT INTO admission_handoffs
               (id, external_identity_id, provider_revision_id, token_digest,
                browser_binding_digest, revocation_generation, display_attributes, expires_at)
             VALUES ($1, $2, $3, $4, $5, 1, '[]'::jsonb, CURRENT_TIMESTAMP + interval '1 minute')`,
            [handoffId, identityId, revisionId, "e".repeat(64), "f".repeat(64)],
          ),
        ).rejects.toThrow()
        await database.query(
          `INSERT INTO admission_handoffs
             (id, external_identity_id, provider_revision_id, token_digest,
              browser_binding_digest, revocation_generation, display_attributes, expires_at)
           VALUES ($1, $2, $3, $4, $5, 1, '{"login":"octocat"}'::jsonb,
                   CURRENT_TIMESTAMP + interval '1 minute')`,
          [handoffId, identityId, revisionId, "e".repeat(64), "f".repeat(64)],
        )
        await expect(
          database.query(`DELETE FROM admission_handoffs WHERE id = $1`, [handoffId]),
        ).rejects.toThrow("Unexpired admission handoffs cannot be deleted")
        await database.query(
          `UPDATE admission_handoffs SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [handoffId],
        )
        await expect(
          database.query(
            `UPDATE admission_handoffs SET display_attributes = '{"login":"changed"}'::jsonb
             WHERE id = $1`,
            [handoffId],
          ),
        ).rejects.toThrow("first consumption")
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
