import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 120_000

describe("repository access migration", () => {
  it(
    "preserves existing identity, session, repository, prototype, Build, and audit records",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_access_upgrade_${randomBytes(8).toString("hex")}`
      const admin = new pg.Client({ connectionString: adminUrl })
      await admin.connect()
      let created = false
      try {
        await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
        created = true
        const databaseUrl = new URL(adminUrl)
        databaseUrl.pathname = name
        const database = new pg.Client({ connectionString: databaseUrl.toString() })
        await database.connect()
        try {
          const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
          const migrationDirectory = join(hubRoot, "schema/migrations")
          const accessMigration = "20261201120000_repository_access_grants"
          const baseMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < accessMigration)
            .map((entry) => entry.name)
            .sort()
          for (const migrationName of baseMigrations) {
            const sql = await readFile(
              join(migrationDirectory, migrationName, "migration.sql"),
              "utf8",
            )
            if (migrationName === "20261104190000_entra_oidc_authentication") {
              const statements = sql.split("\n")
              await database.query(statements.slice(0, 2).join("\n"))
              await database.query(statements.slice(2).join("\n"))
            } else {
              await database.query(sql)
            }
          }

          const providerId = randomUUID()
          const revisionId = randomUUID()
          const userId = randomUUID()
          const identityId = randomUUID()
          const membershipId = randomUUID()
          const sessionId = randomUUID()
          const repositoryId = randomUUID()
          const disconnectedId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const auditId = randomUUID()
          await database.query(
            `INSERT INTO authentication_providers (id, key, enabled) VALUES ($1, 'github', false)`,
            [providerId],
          )
          await database.query(
            `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest) VALUES ($1, $2, 1, $3)`,
            [revisionId, providerId, "a".repeat(64)],
          )
          await database.query(
            `UPDATE authentication_providers SET enabled = true, selected_revision_id = $1
             WHERE id = $2`,
            [revisionId, providerId],
          )
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
          await database.query(
            `INSERT INTO external_identities (id, user_id, provider, issuer, subject)
             VALUES ($1, $2, 'github', 'https://github.com', '12345')`,
            [identityId, userId],
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
          await database.query(
            `INSERT INTO hub_sessions
             (id, membership_id, external_identity_id, provider_revision_id, digest,
              revocation_revision, expires_at)
             VALUES ($1, $2, $3, $4, $5, 0, clock_timestamp() + interval '1 hour')`,
            [sessionId, membershipId, identityId, revisionId, "b".repeat(64)],
          )
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch, removed_at)
             VALUES ($1, 'team/design', 'main', NULL),
                    ($2, 'team/archived', 'main', clock_timestamp())`,
            [repositoryId, disconnectedId],
          )
          await database.query(
            `INSERT INTO prototypes
             (id, repository_id, author_id, branch_name, name, registered_at)
             VALUES ($1, $2, $3, 'prototype/welcome', 'Welcome', clock_timestamp())`,
            [prototypeId, repositoryId, userId],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state)
             VALUES ($1, $2, 1, 'successful')`,
            [buildId, prototypeId],
          )
          await database.query(`UPDATE prototypes SET current_build_id = $1 WHERE id = $2`, [
            buildId,
            prototypeId,
          ])
          await database.query(
            `INSERT INTO security_audits (id, action, outcome, target_type, target_id, context)
             VALUES ($1, 'migration_fixture', 'SUCCESS', 'membership', $2, '{"source":"fixture"}')`,
            [auditId, membershipId],
          )

          async function records() {
            const result = await database.query(
              `SELECT repo.id AS repository_id, repo.name_with_owner, repo.removed_at,
                      prototype.id AS prototype_id, prototype.name, prototype.current_build_id,
                      build.id AS build_id, build.number, build.state::text,
                      member.id AS membership_id, assignment.role::text, identity.subject,
                      session.id AS session_id, session.digest, session.ended_at,
                      audit.id AS audit_id, audit.context
               FROM repositories repo
               JOIN prototypes prototype ON prototype.repository_id = repo.id
               JOIN builds build ON build.id = prototype.current_build_id
               JOIN memberships member ON member.id = $1
               JOIN membership_assignments assignment ON assignment.membership_id = member.id
               JOIN external_identities identity ON identity.id = assignment.external_identity_id
               JOIN hub_sessions session ON session.membership_id = member.id
               JOIN security_audits audit ON audit.id = $2
               WHERE repo.id = $3`,
              [membershipId, auditId, repositoryId],
            )
            const disconnected = await database.query(
              `SELECT id, name_with_owner, removed_at FROM repositories WHERE id = $1`,
              [disconnectedId],
            )
            return { productAndIdentity: result.rows, disconnected: disconnected.rows }
          }
          const before = await records()
          expect(before.productAndIdentity).toHaveLength(1)
          expect(before.disconnected).toHaveLength(1)

          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of baseMigrations) {
            await run(
              process.execPath,
              [
                prismaCli,
                "migrate",
                "resolve",
                "--applied",
                migrationName,
                "--config",
                "prisma7.config.ts",
              ],
              options,
            )
          }
          await run(
            process.execPath,
            [prismaCli, "migrate", "deploy", "--config", "prisma7.config.ts"],
            options,
          )

          expect(await records()).toEqual(before)
          const newFields = await database.query(
            `SELECT repo.github_repository_id, session.end_reason
             FROM repositories repo CROSS JOIN hub_sessions session
             WHERE repo.id = $1 AND session.id = $2`,
            [repositoryId, sessionId],
          )
          expect(newFields.rows).toEqual([{ github_repository_id: null, end_reason: null }])
          const authority = await database.query(
            `SELECT id, key, revision, changed_at, created_at FROM github_repository_access_states`,
          )
          expect(authority.rows).toEqual([
            expect.objectContaining({ key: "global", revision: 0, changed_at: null }),
          ])
          const changedAt = new Date("2026-11-13T20:00:00.000Z")
          const later = new Date("2026-11-13T20:00:01.000Z")
          const advance = await database.query(
            `UPDATE github_repository_access_states SET revision = 1, changed_at = $1
             RETURNING id, key, revision, changed_at, created_at`,
            [changedAt],
          )
          expect(advance.rows).toEqual([
            { ...authority.rows[0], revision: 1, changed_at: changedAt },
          ])
          const fenceQuery =
            "SELECT id, key, revision, changed_at, created_at FROM github_repository_access_states"
          for (const [revision, timestamp] of [
            [3, later],
            [1, later],
            [2, changedAt],
            [2, new Date(changedAt.getTime() - 1)],
            [2, null],
          ]) {
            await expect(
              database.query(
                `UPDATE github_repository_access_states SET revision = $1, changed_at = $2`,
                [revision, timestamp],
              ),
            ).rejects.toMatchObject({ code: "P0001" })
            expect((await database.query(fenceQuery)).rows).toEqual(advance.rows)
          }
          for (const mutation of [
            "id = gen_random_uuid()",
            "key = 'replacement'",
            "created_at = created_at - interval '1 second'",
          ]) {
            await expect(
              database.query(
                `UPDATE github_repository_access_states
                 SET revision = 2, changed_at = $1, ${mutation}`,
                [later],
              ),
            ).rejects.toMatchObject({ code: "P0001" })
            expect((await database.query(fenceQuery)).rows).toEqual(advance.rows)
          }

          await database.query(
            `INSERT INTO repository_access_grants (id, membership_id, repository_id, observed_at)
             VALUES ($1, $2, $3, clock_timestamp())`,
            [randomUUID(), membershipId, repositoryId],
          )
          await expect(
            database.query(
              `INSERT INTO repository_access_grants (id, membership_id, repository_id, observed_at)
               VALUES ($1, $2, $3, clock_timestamp())`,
              [randomUUID(), membershipId, repositoryId],
            ),
          ).rejects.toMatchObject({ code: "23505" })
          await expect(
            database.query(`DELETE FROM github_repository_access_states`),
          ).rejects.toThrow("GitHub repository access authority cannot be deleted.")
          expect((await database.query(fenceQuery)).rows).toEqual(advance.rows)
        } finally {
          await database.end()
        }
      } finally {
        try {
          if (created) await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
        } finally {
          await admin.end()
        }
      }
    },
    migrationTestTimeoutMs,
  )
})
