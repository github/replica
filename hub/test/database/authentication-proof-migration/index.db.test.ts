import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"

describe("Hub admission migration compatibility", () => {
  it("preserves exact C2 parent records and backfills sign-in purpose", async () => {
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
        const attemptId = "00000000-0000-4000-8000-000000000013"
        const identityId = "00000000-0000-4000-8000-000000000015"
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
          [identityId, userId],
        )
        await database.query("COMMIT")
        await database.query(
          `INSERT INTO authorization_attempts
             (id, provider_revision_id, state_digest, browser_binding_digest,
              code_verifier_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4, 'encrypted', CURRENT_TIMESTAMP + interval '1 minute')`,
          [attemptId, revisionId, "c".repeat(64), "d".repeat(64)],
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

        const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        for (const migrationName of [c1MigrationName, c2MigrationName]) {
          await promisify(execFile)(
            process.execPath,
            [
              prismaCli,
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
          [prismaCli, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
          options,
        )

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
        const upgradedAttempt = await database.query<{ purpose: string }>(
          `SELECT purpose::text FROM authorization_attempts WHERE id = $1`,
          [attemptId],
        )

        expect(upgradedRecords.rows).toEqual(c2Records.rows)
        expect(upgradedAttempt.rows).toEqual([{ purpose: "SIGN_IN" }])
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)

  it("makes the member role available without adding a member admission path", async () => {
    await expect(
      prisma.$queryRaw<Array<{ role: string }>>`
        SELECT 'MEMBER'::"MembershipRole"::text AS role
      `,
    ).resolves.toEqual([{ role: "MEMBER" }])
  })
})
