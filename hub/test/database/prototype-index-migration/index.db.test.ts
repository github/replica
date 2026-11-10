import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("prototype index migration", () => {
  it("preserves existing membership and session data when upgrading the exact base", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_index_upgrade_${randomBytes(8).toString("hex")}`
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
        const baseMigrations = [
          "20261029203000_identity_foundation",
          "20261030170000_authentication_proof",
          "20261102130000_hub_admission_sessions",
          "20261104190000_entra_oidc_authentication",
          "20261109130000_administrator_management_assignment_source",
          "20261109130100_administrator_management_authority",
          "20261109150000_administrator_authorization_purpose",
          "20261109160000_administrator_authorization_api",
        ]
        for (const migrationName of baseMigrations) {
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
        const revisionId = randomUUID()
        const userId = randomUUID()
        const identityId = randomUUID()
        const membershipId = randomUUID()
        const sessionId = randomUUID()
        await database.query(
          `INSERT INTO authentication_providers (id, key, enabled)
           VALUES ($1, 'github', false)`,
          [providerId],
        )
        await database.query(
          `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest)
           VALUES ($1, $2, 1, $3)`,
          [revisionId, providerId, "a".repeat(64)],
        )
        await database.query(
          `UPDATE authentication_providers SET enabled = true, selected_revision_id = $1
           WHERE id = $2`,
          [revisionId, providerId],
        )
        await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
        await database.query(
          `INSERT INTO user_profiles (id, user_id, provider, login, name)
           VALUES ($1, $2, 'github', 'mona', 'Mona')`,
          [randomUUID(), userId],
        )
        await database.query(
          `INSERT INTO external_identities (id, user_id, provider, issuer, subject)
           VALUES ($1, $2, 'github', 'https://github.com', 'mona-id')`,
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

        const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        for (const migrationName of baseMigrations) {
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

        const existing = await database.query(
          `SELECT session.id AS session_id, session.digest,
                  session.external_identity_id, session.provider_revision_id,
                  membership.id AS membership_id, membership.lifecycle::text,
                  assignment.role::text, profile.user_id, profile.provider, profile.login
           FROM hub_sessions session
           JOIN memberships membership ON membership.id = session.membership_id
           JOIN membership_assignments assignment ON assignment.membership_id = membership.id
           JOIN user_profiles profile ON profile.user_id = membership.user_id
           WHERE session.id = $1`,
          [sessionId],
        )
        expect(existing.rows).toEqual([
          {
            session_id: sessionId,
            digest: "b".repeat(64),
            external_identity_id: identityId,
            provider_revision_id: revisionId,
            membership_id: membershipId,
            lifecycle: "ACTIVE",
            role: "ADMINISTRATOR",
            user_id: userId,
            provider: "github",
            login: "mona",
          },
        ])

        const repositoryId = randomUUID()
        const prototypeId = randomUUID()
        await database.query(
          `INSERT INTO repositories (id, name_with_owner, default_branch)
           VALUES ($1, 'team/design', 'main')`,
          [repositoryId],
        )
        await database.query(
          `INSERT INTO prototypes (id, repository_id, author_id, branch_name, name, registered_at)
           VALUES ($1, $2, $3, 'prototype/welcome', 'Welcome', clock_timestamp())`,
          [prototypeId, repositoryId, userId],
        )
        const prototype = await database.query(
          `SELECT prototype.id, repository.name_with_owner, profile.login
           FROM prototypes prototype
           JOIN repositories repository ON repository.id = prototype.repository_id
           JOIN user_profiles profile ON profile.user_id = prototype.author_id
           WHERE prototype.id = $1`,
          [prototypeId],
        )
        expect(prototype.rows).toEqual([
          { id: prototypeId, name_with_owner: "team/design", login: "mona" },
        ])
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 60_000)
})
