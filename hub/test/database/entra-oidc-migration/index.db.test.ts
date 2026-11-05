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

        const columns = await database.query<{ column_name: string; table_name: string }>(
          `SELECT table_name, column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND (
               (table_name = 'authorization_attempts'
                 AND column_name IN ('nonce_ciphertext', 'requires_fresh_authentication'))
               OR
               (table_name = 'authentication_providers'
                 AND column_name = 'enabled')
               OR
               (table_name = 'membership_assignments'
                 AND column_name IN ('provider_revision_id', 'provider_assignment_subject'))
               OR
               (table_name = 'provider_evidence_states'
                 AND column_name IN (
                   'id',
                   'external_identity_id',
                   'last_issued_at',
                   'created_at',
                   'updated_at'
                 ))
             )
           ORDER BY table_name, column_name`,
        )
        expect(columns.rows).toEqual([
          { table_name: "authentication_providers", column_name: "enabled" },
          { table_name: "authorization_attempts", column_name: "nonce_ciphertext" },
          {
            table_name: "membership_assignments",
            column_name: "provider_assignment_subject",
          },
          { table_name: "membership_assignments", column_name: "provider_revision_id" },
          { table_name: "provider_evidence_states", column_name: "created_at" },
          { table_name: "provider_evidence_states", column_name: "external_identity_id" },
          { table_name: "provider_evidence_states", column_name: "id" },
          { table_name: "provider_evidence_states", column_name: "last_issued_at" },
          { table_name: "provider_evidence_states", column_name: "updated_at" },
        ])
        await expect(
          database.query(`SELECT enabled FROM authentication_providers WHERE id = $1`, [
            providerId,
          ]),
        ).resolves.toMatchObject({ rows: [{ enabled: true }] })

        const enumValues = await database.query<{ enum_name: string; value: string }>(
          `SELECT type.typname AS enum_name, value.enumlabel AS value
           FROM pg_type type
           JOIN pg_enum value ON value.enumtypid = type.oid
           WHERE type.typname IN (
             'MembershipAssignmentLifecycle',
             'MembershipAssignmentSource',
             'MembershipRole'
           )
           ORDER BY type.typname, value.enumsortorder`,
        )
        expect(enumValues.rows).toEqual([
          { enum_name: "MembershipAssignmentLifecycle", value: "ACTIVE" },
          { enum_name: "MembershipAssignmentLifecycle", value: "SUPERSEDED" },
          { enum_name: "MembershipAssignmentLifecycle", value: "REVOKED" },
          { enum_name: "MembershipAssignmentSource", value: "BOOTSTRAP" },
          { enum_name: "MembershipAssignmentSource", value: "AUTHENTICATION_PROVIDER" },
          { enum_name: "MembershipRole", value: "ADMINISTRATOR" },
          { enum_name: "MembershipRole", value: "MEMBER" },
        ])

        const indexes = await database.query<{ indexdef: string; indexname: string }>(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'membership_assignments'
           ORDER BY indexname`,
        )
        expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
          "membership_assignments_active_bootstrap_key",
          "membership_assignments_active_provider_identity_key",
          "membership_assignments_active_provider_membership_idx",
          "membership_assignments_pkey",
          "membership_assignments_provider_revision_id_idx",
        ])
        expect(indexes.rows[0]?.indexdef).toContain("(membership_id)")
        expect(indexes.rows[1]?.indexdef).toContain("(external_identity_id)")
        expect(indexes.rows[2]?.indexdef).toMatch(
          /CREATE INDEX .* ON public\.membership_assignments USING btree \(membership_id/,
        )
        expect(indexes.rows[3]?.indexdef).toContain("(id)")
        expect(indexes.rows[4]?.indexdef).toContain("(provider_revision_id)")

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

        const constraints = await database.query<{ conname: string }>(
          `SELECT constraint_record.conname
           FROM pg_constraint constraint_record
           JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
           JOIN pg_namespace schema_record ON schema_record.oid = table_record.relnamespace
           WHERE schema_record.nspname = 'public'
             AND table_record.relname = 'membership_assignments'
             AND constraint_record.conname IN (
               'membership_assignments_external_identity_id_fkey',
               'membership_assignments_membership_id_fkey',
               'membership_assignments_pkey',
               'membership_assignments_provider_revision_id_fkey',
               'membership_assignments_source_contract'
             )
           ORDER BY constraint_record.conname`,
        )
        expect(constraints.rows).toEqual([
          { conname: "membership_assignments_external_identity_id_fkey" },
          { conname: "membership_assignments_membership_id_fkey" },
          { conname: "membership_assignments_pkey" },
          { conname: "membership_assignments_provider_revision_id_fkey" },
          { conname: "membership_assignments_source_contract" },
        ])

        const evidenceConstraints = await database.query<{ conname: string }>(
          `SELECT constraint_record.conname
           FROM pg_constraint constraint_record
           JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
           JOIN pg_namespace schema_record ON schema_record.oid = table_record.relnamespace
           WHERE schema_record.nspname = 'public'
             AND table_record.relname = 'provider_evidence_states'
             AND constraint_record.conname IN (
               'provider_evidence_states_external_identity_id_fkey',
               'provider_evidence_states_pkey'
             )
           ORDER BY constraint_record.conname`,
        )
        expect(evidenceConstraints.rows).toEqual([
          { conname: "provider_evidence_states_external_identity_id_fkey" },
          { conname: "provider_evidence_states_pkey" },
        ])
        const evidenceIndexes = await database.query<{ indexdef: string; indexname: string }>(
          `SELECT indexname, indexdef
           FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'provider_evidence_states'
           ORDER BY indexname`,
        )
        expect(evidenceIndexes.rows.map(({ indexname }) => indexname)).toEqual([
          "provider_evidence_states_external_identity_id_key",
          "provider_evidence_states_pkey",
        ])
        expect(evidenceIndexes.rows[0]?.indexdef).toContain("UNIQUE INDEX")
        expect(evidenceIndexes.rows[1]?.indexdef).toMatch(/UNIQUE INDEX .* \(id\)$/)
        const evidenceTrigger = await database.query<{ definition: string; name: string }>(
          `SELECT trigger_record.tgname AS name,
                  pg_get_triggerdef(trigger_record.oid) AS definition
           FROM pg_trigger trigger_record
           JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
           JOIN pg_namespace schema_record ON schema_record.oid = table_record.relnamespace
           WHERE schema_record.nspname = 'public'
             AND table_record.relname = 'provider_evidence_states'
             AND NOT trigger_record.tgisinternal`,
        )
        expect(evidenceTrigger.rows.map(({ name }) => name)).toEqual([
          "provider_evidence_states_protected",
        ])
        expect(evidenceTrigger.rows[0]?.definition).toMatch(
          /BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE) ON public\.provider_evidence_states .* protect_provider_evidence_state\(\)/,
        )

        const attemptTriggers = await database.query<{ definition: string; name: string }>(
          `SELECT trigger_record.tgname AS name,
                  pg_get_triggerdef(trigger_record.oid) AS definition
           FROM pg_trigger trigger_record
           JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
           JOIN pg_namespace schema_record ON schema_record.oid = table_record.relnamespace
           WHERE schema_record.nspname = 'public'
             AND table_record.relname = 'authorization_attempts'
             AND NOT trigger_record.tgisinternal
           ORDER BY trigger_record.tgname`,
        )
        expect(attemptTriggers.rows.map(({ name }) => name)).toEqual([
          "authorization_attempts_authority_protected",
          "authorization_attempts_nonce_protected",
          "authorization_attempts_protected",
        ])
        expect(attemptTriggers.rows[0]?.definition).toContain(
          "protect_authorization_attempt_authority()",
        )
        expect(attemptTriggers.rows[1]?.definition).toContain(
          "protect_authorization_attempt_nonce()",
        )

        await expect(
          database.query(`SELECT nonce_ciphertext FROM authorization_attempts WHERE id = $1`, [
            attemptId,
          ]),
        ).resolves.toMatchObject({ rows: [{ nonce_ciphertext: null }] })
        await expect(
          database.query(
            `UPDATE authorization_attempts SET nonce_ciphertext = 'changed' WHERE id = $1`,
            [attemptId],
          ),
        ).rejects.toThrow(/Authorization attempt nonce is immutable/)
        await expect(
          database.query(
            `UPDATE authorization_attempts
             SET bootstrap_secret_digest = $2
             WHERE id = $1`,
            [attemptId, "d".repeat(64)],
          ),
        ).rejects.toThrow(/Authorization attempt authority is immutable/)
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
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 60_000)
})
