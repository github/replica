import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

function readParentAuthority(database: pg.Client, userId: string, providerId: string) {
  return database.query(
    `SELECT
       provider.key AS provider_key,
       revision.revision,
       attempt.purpose::text AS purpose,
       membership.lifecycle::text AS membership_lifecycle,
       assignment.source::text AS assignment_source,
       assignment.role::text AS assignment_role,
       assignment.lifecycle::text AS assignment_lifecycle
     FROM authentication_providers provider
     JOIN authentication_provider_revisions revision
       ON revision.id = provider.selected_revision_id
     JOIN authorization_attempts attempt ON attempt.provider_revision_id = revision.id
     JOIN memberships membership ON membership.user_id = $1
     JOIN membership_assignments assignment ON assignment.membership_id = membership.id
     WHERE provider.id = $2`,
    [userId, providerId],
  )
}

describe("Entra OIDC migration compatibility", () => {
  it("upgrades the exact parent admission schema without changing parent authority", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_entra_upgrade_${randomBytes(8).toString("hex")}`
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
        ]
        for (const migrationName of parentMigrations) {
          await database.query(
            await readFile(
              join(hubRoot, "schema/migrations", migrationName, "migration.sql"),
              "utf8",
            ),
          )
        }
        await database.query(
          `UPDATE session_revocation_states
           SET revision = revision + 1, updated_at = clock_timestamp()
           WHERE key = 'global'`,
        )

        const providerId = "00000000-0000-4000-8000-000000000010"
        const revisionId = "00000000-0000-4000-8000-000000000011"
        const userId = "00000000-0000-4000-8000-000000000012"
        const identityId = "00000000-0000-4000-8000-000000000013"
        const attemptId = "00000000-0000-4000-8000-000000000014"
        const membershipId = "00000000-0000-4000-8000-000000000015"
        const assignmentId = "00000000-0000-4000-8000-000000000016"
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
        await database.query(
          `INSERT INTO authorization_attempts
             (id, provider_revision_id, state_digest, browser_binding_digest, purpose,
              code_verifier_ciphertext, expires_at)
           VALUES ($1, $2, $3, $4, 'ADMIN_ENROLLMENT', 'encrypted',
             CURRENT_TIMESTAMP + interval '1 minute')`,
          [attemptId, revisionId, "b".repeat(64), "c".repeat(64)],
        )
        await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
          membershipId,
          userId,
        ])
        await database.query(
          `INSERT INTO membership_assignments
             (id, membership_id, external_identity_id, source, role)
           VALUES ($1, $2, $3, 'BOOTSTRAP', 'ADMINISTRATOR')`,
          [assignmentId, membershipId, identityId],
        )
        await database.query("COMMIT")

        const parentRecords = await readParentAuthority(database, userId, providerId)

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

        const upgradedRecords = await readParentAuthority(database, userId, providerId)
        expect(upgradedRecords.rows).toEqual(parentRecords.rows)

        await expect(
          database.query(`SELECT enabled FROM authentication_providers WHERE id = $1`, [
            providerId,
          ]),
        ).resolves.toMatchObject({ rows: [{ enabled: true }] })

        const secondRevisionId = "00000000-0000-4000-8000-000000000022"
        await database.query("BEGIN")
        await database.query(
          `UPDATE authentication_providers
           SET enabled = false, selected_revision_id = NULL
           WHERE id = $1`,
          [providerId],
        )
        await expect(
          database.query(
            `SELECT enabled, selected_revision_id, last_disabled_revision_id
             FROM authentication_providers
             WHERE id = $1`,
            [providerId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              enabled: false,
              last_disabled_revision_id: revisionId,
              selected_revision_id: null,
            },
          ],
        })
        await database.query("SAVEPOINT same_revision_reactivation")
        await expect(
          database.query(
            `UPDATE authentication_providers
             SET enabled = true, selected_revision_id = $2
             WHERE id = $1`,
            [providerId, revisionId],
          ),
        ).rejects.toThrow(/Re-enabling an authentication provider requires a new revision/)
        await database.query("ROLLBACK TO SAVEPOINT same_revision_reactivation")
        await database.query(
          `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest)
           VALUES ($1, $2, 2, $3)`,
          [secondRevisionId, providerId, "a".repeat(64)],
        )
        await database.query(
          `UPDATE authentication_providers
           SET enabled = true, selected_revision_id = $2
           WHERE id = $1`,
          [providerId, secondRevisionId],
        )
        await expect(
          database.query(
            `SELECT enabled, selected_revision_id
             FROM authentication_providers
             WHERE id = $1`,
            [providerId],
          ),
        ).resolves.toMatchObject({
          rows: [{ enabled: true, selected_revision_id: secondRevisionId }],
        })
        await database.query("ROLLBACK")

        await database.query("SET enable_seqscan = off")
        const providerAssignmentPlan = await database.query<{ "QUERY PLAN": string }>(
          `EXPLAIN (COSTS OFF)
           SELECT provider_revision_id
           FROM membership_assignments
           WHERE membership_id = $1
             AND source = 'AUTHENTICATION_PROVIDER'
             AND lifecycle = 'ACTIVE'`,
          [membershipId],
        )
        expect(providerAssignmentPlan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
          "membership_assignments_active_provider_membership_idx",
        )

        const bootstrapAssignmentIndex = await database.query<{
          indisunique: boolean
          predicate: string
        }>(
          `SELECT
             index_definition.indisunique,
             pg_get_expr(index_definition.indpred, index_definition.indrelid) AS predicate
           FROM pg_class index_name
           JOIN pg_index index_definition ON index_definition.indexrelid = index_name.oid
           WHERE index_name.relname = 'membership_assignments_bootstrap_membership_idx'`,
        )
        expect(bootstrapAssignmentIndex.rows).toHaveLength(1)
        expect(bootstrapAssignmentIndex.rows[0]?.indisunique).toBe(false)
        expect(bootstrapAssignmentIndex.rows[0]?.predicate).toContain("'BOOTSTRAP'")
        expect(bootstrapAssignmentIndex.rows[0]!.predicate).toContain("'ADMINISTRATOR'")
        expect(bootstrapAssignmentIndex.rows[0]!.predicate).not.toContain("lifecycle")

        for (const lifecycle of ["ACTIVE", "REVOKED"] as const) {
          if (lifecycle === "REVOKED") {
            await database.query(
              `UPDATE membership_assignments
               SET lifecycle = 'REVOKED', updated_at = clock_timestamp()
               WHERE id = $1`,
              [assignmentId],
            )
          }
          const bootstrapAssignment = await database.query<{ lifecycle: string }>(
            `SELECT lifecycle::text
             FROM membership_assignments
             WHERE membership_id = $1::uuid
               AND source = 'BOOTSTRAP'
               AND role = 'ADMINISTRATOR'
             FOR UPDATE`,
            [membershipId],
          )
          expect(bootstrapAssignment.rows).toEqual([{ lifecycle }])
          const bootstrapAssignmentPlan = await database.query<{ "QUERY PLAN": string }>(
            `EXPLAIN (COSTS OFF)
             SELECT external_identity_id, lifecycle::text
             FROM membership_assignments
             WHERE membership_id = $1::uuid
               AND source = 'BOOTSTRAP'
               AND role = 'ADMINISTRATOR'
             FOR UPDATE`,
            [membershipId],
          )
          expect(
            bootstrapAssignmentPlan.rows.map((row) => row["QUERY PLAN"]).join("\n"),
            `${lifecycle} bootstrap lookup plan`,
          ).toContain("membership_assignments_bootstrap_membership_idx")
        }
        await database.query(
          `UPDATE membership_assignments
           SET lifecycle = 'ACTIVE', updated_at = clock_timestamp()
           WHERE id = $1`,
          [assignmentId],
        )

        await expect(
          database.query(
            `SELECT nonce_ciphertext, session_revocation_revision
             FROM authorization_attempts
             WHERE id = $1`,
            [attemptId],
          ),
        ).resolves.toMatchObject({
          rows: [{ nonce_ciphertext: null, session_revocation_revision: 0 }],
        })
        const migrationSql = await readFile(
          join(hubRoot, "schema/migrations/20261104190000_entra_oidc_authentication/migration.sql"),
          "utf8",
        )
        expect(migrationSql).not.toContain('DISABLE TRIGGER "authorization_attempts_protected"')
        expect(migrationSql).not.toContain(
          'DISABLE TRIGGER "authorization_attempts_authority_protected"',
        )
        await expect(
          database.query(
            `UPDATE authorization_attempts SET nonce_ciphertext = 'changed' WHERE id = $1`,
            [attemptId],
          ),
        ).rejects.toThrow(/Authorization attempt history is immutable/)
        await expect(
          database.query(
            `UPDATE authorization_attempts
             SET session_revocation_revision = session_revocation_revision + 1
             WHERE id = $1`,
            [attemptId],
          ),
        ).rejects.toThrow(/Authorization attempt history is immutable/)
        await expect(
          database.query(
            `UPDATE authorization_attempts
             SET bootstrap_secret_digest = $2
             WHERE id = $1`,
            [attemptId, "d".repeat(64)],
          ),
        ).rejects.toThrow(/Authorization attempt authority is immutable/)
        const evidenceStateId = "00000000-0000-4000-8000-000000000020"
        await database.query(
          `INSERT INTO provider_evidence_states
             (id, external_identity_id, last_issued_at, last_role)
           VALUES ($1, $2, $3, 'MEMBER')`,
          [evidenceStateId, identityId, new Date("2026-11-05T12:00:00Z")],
        )
        await expect(
          database.query(
            `UPDATE provider_evidence_states
             SET last_issued_at = last_issued_at - interval '1 second',
                 updated_at = updated_at + interval '1 second'
             WHERE id = $1`,
            [evidenceStateId],
          ),
        ).rejects.toThrow(/Provider evidence ordering must advance monotonically/)
        await expect(
          database.query(`DELETE FROM provider_evidence_states WHERE id = $1`, [evidenceStateId]),
        ).rejects.toThrow(/Provider evidence ordering history cannot be deleted/)
        await expect(
          database.query(
            `SELECT provider_revision_id, provider_assignment_subject
             FROM membership_assignments
             WHERE id = $1`,
            [assignmentId],
          ),
        ).resolves.toMatchObject({
          rows: [{ provider_assignment_subject: null, provider_revision_id: null }],
        })
        await expect(
          database.query(
            `INSERT INTO membership_assignments
               (id, membership_id, external_identity_id, provider_revision_id, source, role,
                provider_assignment_subject)
             VALUES ($1, $2, $3, $4, 'AUTHENTICATION_PROVIDER', 'MEMBER', NULL)`,
            ["00000000-0000-4000-8000-000000000017", membershipId, identityId, revisionId],
          ),
        ).rejects.toThrow()
        const providerAssignmentId = "00000000-0000-4000-8000-000000000018"
        const opaqueAssignmentSubject = "Tenant-Opaque.Subject_42"
        await database.query(
          `INSERT INTO membership_assignments
             (id, membership_id, external_identity_id, provider_revision_id, source, role,
              provider_assignment_subject)
           VALUES ($1, $2, $3, $4, 'AUTHENTICATION_PROVIDER', 'MEMBER', $5)`,
          [providerAssignmentId, membershipId, identityId, revisionId, opaqueAssignmentSubject],
        )
        await database.query(
          `UPDATE membership_assignments
           SET lifecycle = 'SUPERSEDED', updated_at = updated_at + interval '1 second'
           WHERE id = $1`,
          [providerAssignmentId],
        )
        await expect(
          database.query(
            `SELECT lifecycle, provider_assignment_subject
             FROM membership_assignments
             WHERE id = $1`,
            [providerAssignmentId],
          ),
        ).resolves.toMatchObject({
          rows: [
            {
              lifecycle: "SUPERSEDED",
              provider_assignment_subject: opaqueAssignmentSubject,
            },
          ],
        })
        await expect(
          database.query(
            `INSERT INTO membership_assignments
               (id, membership_id, external_identity_id, provider_revision_id, source, role,
                provider_assignment_subject)
             VALUES ($1, $2, $3, $4, 'AUTHENTICATION_PROVIDER', 'MEMBER', '')`,
            ["00000000-0000-4000-8000-000000000021", membershipId, identityId, revisionId],
          ),
        ).rejects.toThrow()
        await expect(
          database.query(
            `INSERT INTO membership_assignments
               (id, membership_id, external_identity_id, provider_revision_id, source, role,
                provider_assignment_subject)
             VALUES ($1, $2, $3, $4, 'AUTHENTICATION_PROVIDER', 'MEMBER', $5)`,
            [
              "00000000-0000-4000-8000-000000000022",
              membershipId,
              identityId,
              revisionId,
              "A".repeat(101),
            ],
          ),
        ).rejects.toThrow()
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 60_000)
})
