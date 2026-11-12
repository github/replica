import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("administrator authorization migration compatibility", () => {
  it("backfills open and ended sessions from the exact administrator authority base", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_administrator_authorization_upgrade_${randomBytes(8).toString("hex")}`
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
        const parentMigrations = [
          "20261029203000_identity_foundation",
          "20261030170000_authentication_proof",
          "20261102130000_hub_admission_sessions",
          "20261104190000_entra_oidc_authentication",
          "20261109130000_administrator_management_assignment_source",
          "20261109130100_administrator_management_authority",
        ]
        for (const migrationName of parentMigrations) {
          const migration = await readFile(
            join(hubRoot, "schema/migrations", migrationName, "migration.sql"),
            "utf8",
          )
          if (migrationName === "20261104190000_entra_oidc_authentication") {
            const statements = migration.split("\n")
            await database.query(statements.slice(0, 2).join("\n"))
            await database.query(statements.slice(2).join("\n"))
          } else {
            await database.query(migration)
          }
        }

        const providerId = randomUUID()
        const providerRevisionId = randomUUID()
        const userId = randomUUID()
        const identityId = randomUUID()
        const membershipId = randomUUID()
        await database.query(
          `INSERT INTO authentication_providers
             (id, key, enabled, selected_revision_id)
           VALUES ($1, 'github', false, null)`,
          [providerId],
        )
        await database.query(
          `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest)
           VALUES ($1, $2, 1, $3)`,
          [providerRevisionId, providerId, "a".repeat(64)],
        )
        await database.query(
          `UPDATE authentication_providers
           SET enabled = true, selected_revision_id = $1
           WHERE id = $2`,
          [providerRevisionId, providerId],
        )
        await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
        await database.query(
          `INSERT INTO external_identities
             (id, user_id, provider, issuer, subject)
           VALUES ($1, $2, 'github', 'https://github.com', $3)`,
          [identityId, userId, randomUUID()],
        )
        await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
          membershipId,
          userId,
        ])
        await database.query(
          `INSERT INTO membership_assignments
             (id, membership_id, external_identity_id, source, role)
           VALUES ($1, $2, $3, 'BOOTSTRAP', 'ADMINISTRATOR')`,
          [randomUUID(), membershipId, identityId],
        )
        const openSessionId = randomUUID()
        const endedSessionId = randomUUID()
        await database.query(
          `INSERT INTO hub_sessions
             (id, membership_id, digest, revocation_revision, expires_at, ended_at)
           VALUES
             ($1, $3, $4, 0, clock_timestamp() + interval '1 hour', null),
             ($2, $3, $5, 0, clock_timestamp() + interval '1 hour', clock_timestamp())`,
          [openSessionId, endedSessionId, membershipId, "b".repeat(64), "c".repeat(64)],
        )

        const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        for (const migrationName of parentMigrations) {
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

        const sessions = await database.query<{
          endedAt: Date | null
          externalIdentityId: string
          id: string
          providerRevisionId: string
        }>(
          `SELECT
               id,
               external_identity_id AS "externalIdentityId",
               provider_revision_id AS "providerRevisionId",
               ended_at AS "endedAt"
             FROM hub_sessions
             ORDER BY id`,
        )
        expect(sessions.rows).toHaveLength(2)
        expect(sessions.rows).toContainEqual({
          id: openSessionId,
          externalIdentityId: identityId,
          providerRevisionId,
          endedAt: null,
        })
        const endedSession = sessions.rows.find(({ id }) => id === endedSessionId)
        expect(endedSession).toMatchObject({
          id: endedSessionId,
          externalIdentityId: identityId,
          providerRevisionId,
        })
        expect(endedSession?.endedAt).toBeInstanceOf(Date)
        await expect(
          database.query(`UPDATE hub_sessions SET digest = $1 WHERE id = $2`, [
            "d".repeat(64),
            openSessionId,
          ]),
        ).rejects.toThrow("Hub session history is immutable")
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
