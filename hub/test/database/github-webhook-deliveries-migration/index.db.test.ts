import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 120_000

describe("GitHub webhook deliveries migration", () => {
  it(
    "preserves the exact base and stores one receipt per delivery ID",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_webhook_upgrade_${randomBytes(8).toString("hex")}`
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
          const migrations = join(hubRoot, "schema/migrations")
          const deliveryMigration = "20261201150000_github_webhook_deliveries"
          const base = (await readdir(migrations, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < deliveryMigration)
            .map(({ name }) => name)
            .sort()
          expect(base.at(-1)).toBe("20261201140000_prototype_introductions")
          for (const migrationName of base) {
            const sql = await readFile(join(migrations, migrationName, "migration.sql"), "utf8")
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
          const assignmentId = randomUUID()
          const sessionId = randomUUID()
          const repositoryId = randomUUID()
          const grantId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const introductionId = randomUUID()
          const auditId = randomUUID()
          await database.query(
            "INSERT INTO authentication_providers (id, key, enabled) VALUES ($1, 'github', false)",
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
          await database.query("INSERT INTO users (id) VALUES ($1)", [userId])
          await database.query(
            `INSERT INTO external_identities (id, user_id, provider, issuer, subject)
             VALUES ($1, $2, 'github', 'https://github.com', '101')`,
            [identityId, userId],
          )
          await database.query("INSERT INTO memberships (id, user_id) VALUES ($1, $2)", [
            membershipId,
            userId,
          ])
          await database.query(
            `INSERT INTO membership_assignments
             (id, membership_id, external_identity_id, provider_revision_id,
              provider_assignment_subject, source, role)
             VALUES ($1, $2, $3, $4, 'github_repository_access', 'AUTHENTICATION_PROVIDER', 'MEMBER')`,
            [assignmentId, membershipId, identityId, revisionId],
          )
          await database.query(
            `INSERT INTO hub_sessions
             (id, membership_id, external_identity_id, provider_revision_id, digest,
              revocation_revision, expires_at)
             VALUES ($1, $2, $3, $4, $5, 0, '2099-01-01T00:00:00Z')`,
            [sessionId, membershipId, identityId, revisionId, "b".repeat(64)],
          )
          await database.query(
            `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
             VALUES ($1, 1001, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO repository_access_grants (id, membership_id, repository_id, observed_at)
             VALUES ($1, $2, $3, '2026-11-01T00:00:00Z')`,
            [grantId, membershipId, repositoryId],
          )
          await database.query(
            `INSERT INTO prototypes (id, repository_id, author_id, branch_name, name, registered_at)
             VALUES ($1, $2, $3, 'prototype/welcome', 'Welcome', '2026-11-01T00:00:00Z')`,
            [prototypeId, repositoryId, userId],
          )
          await database.query(
            "INSERT INTO builds (id, prototype_id, number, state) VALUES ($1, $2, 1, 'successful')",
            [buildId, prototypeId],
          )
          await database.query("UPDATE prototypes SET current_build_id = $1 WHERE id = $2", [
            buildId,
            prototypeId,
          ])
          await database.query(
            `INSERT INTO prototype_introductions (id, user_id, prototype_id)
             VALUES ($1, $2, $3)`,
            [introductionId, userId, prototypeId],
          )
          await database.query(
            `INSERT INTO security_audits (id, action, outcome, target_type, target_id, context)
             VALUES ($1, 'migration_fixture', 'SUCCESS', 'membership', $2, '{"source":"fixture"}')`,
            [auditId, membershipId],
          )
          await database.query(
            `UPDATE github_repository_access_states
             SET revision = 1, changed_at = '2026-11-01T01:00:00Z'
             WHERE key = 'global'`,
          )

          async function existingRecords() {
            const result = await database.query<Record<string, unknown>>(
              `SELECT provider.selected_revision_id, identity.subject, member.id AS membership_id,
                      assignment.id AS assignment_id, assignment.lifecycle::text,
                      session.id AS session_id, session.digest, session.ended_at,
                      repo.id AS repository_id, repo.github_repository_id, repo.removed_at,
                      grant_row.id AS grant_id, grant_row.observed_at,
                      prototype.id AS prototype_id, prototype.current_build_id,
                      build.id AS build_id, build.state::text,
                      introduction.id AS introduction_id, audit.id AS audit_id, audit.context,
                      fence.revision AS fence_revision, fence.changed_at AS fence_changed_at
               FROM authentication_providers provider
               JOIN external_identities identity ON identity.id = $1
               JOIN memberships member ON member.user_id = identity.user_id
               JOIN membership_assignments assignment ON assignment.membership_id = member.id
               JOIN hub_sessions session ON session.membership_id = member.id
               JOIN repository_access_grants grant_row ON grant_row.membership_id = member.id
               JOIN repositories repo ON repo.id = grant_row.repository_id
               JOIN prototypes prototype ON prototype.repository_id = repo.id
               JOIN builds build ON build.id = prototype.current_build_id
               JOIN prototype_introductions introduction ON introduction.prototype_id = prototype.id
               JOIN security_audits audit ON audit.id = $2
               JOIN github_repository_access_states fence ON fence.key = 'global'
               WHERE provider.id = $3`,
              [identityId, auditId, providerId],
            )
            return result.rows
          }
          const before = await existingRecords()
          expect(before).toHaveLength(1)

          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of base) {
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

          expect(await existingRecords()).toEqual(before)
          expect((await database.query("SELECT id FROM github_webhook_deliveries")).rows).toEqual(
            [],
          )
          const deliveryId = randomUUID()
          const otherDeliveryId = randomUUID()
          const digest = "c".repeat(64)
          const insert = `INSERT INTO github_webhook_deliveries (id, event, payload_digest)
                          VALUES ($1, $2, $3)`
          await database.query(insert, [deliveryId, "membership", digest])
          await expect(
            database.query(insert, [deliveryId, "team", "d".repeat(64)]),
          ).rejects.toMatchObject({
            code: "23505",
          })
          await database.query(insert, [otherDeliveryId, "membership", digest])
          await expect(
            database.query(insert, ["not-a-uuid", "membership", digest]),
          ).rejects.toMatchObject({
            code: "22P02",
          })
          const receipts = await database.query<{
            created_at: Date
            event: string
            id: string
            payload_digest: string
            updated_at: Date
          }>(
            `SELECT id, event, payload_digest, created_at, updated_at
             FROM github_webhook_deliveries ORDER BY id`,
          )
          expect(
            receipts.rows.map(({ event, id, payload_digest }) => ({ event, id, payload_digest })),
          ).toEqual(
            [deliveryId, otherDeliveryId].sort().map((id) => ({
              id,
              event: "membership",
              payload_digest: digest,
            })),
          )
          for (const receipt of receipts.rows) {
            expect(receipt.created_at).toBeInstanceOf(Date)
            expect(receipt.updated_at).toBeInstanceOf(Date)
          }
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
