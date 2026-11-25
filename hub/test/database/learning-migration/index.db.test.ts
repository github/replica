import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 60_000

describe("learning migration", () => {
  it(
    "preserves deleted review comments as pending redaction and enforces run states",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_learning_upgrade_${randomBytes(8).toString("hex")}`
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
          const migrationsRoot = join(hubRoot, "schema/migrations")
          const learningMigration = "20261113190000_learning_run_foundation"
          const baseMigrations = (await readdir(migrationsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < learningMigration)
            .map((entry) => entry.name)
            .sort()
          for (const migrationName of baseMigrations) {
            const sql = await readFile(join(migrationsRoot, migrationName, "migration.sql"), "utf8")
            if (migrationName === "20261104190000_entra_oidc_authentication") {
              const statements = sql.split("\n")
              await database.query(statements.slice(0, 2).join("\n"))
              await database.query(statements.slice(2).join("\n"))
            } else {
              await database.query(sql)
            }
          }

          const repositoryId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const userId = randomUUID()
          const membershipId = randomUUID()
          const threadId = randomUUID()
          const commentId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
          await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
            membershipId,
            userId,
          ])
          await database.query(
            `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
             VALUES ($1, $2, 'prototype/checkout', 'Checkout', clock_timestamp())`,
            [prototypeId, repositoryId],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state)
             VALUES ($1, $2, 4, 'successful')`,
            [buildId, prototypeId],
          )
          await database.query(
            `INSERT INTO review_threads
               (id, repository_id, prototype_id, build_id, anchor)
             VALUES ($1, $2, $3, $4, '{"kind":"element"}')`,
            [threadId, repositoryId, prototypeId, buildId],
          )
          await database.query(
            `INSERT INTO review_comments
               (id, thread_id, author_id, author_login, body, deleted_at)
             VALUES ($1, $2, $3, 'mona', 'Retained deleted text', clock_timestamp())`,
            [commentId, threadId, userId],
          )

          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: timeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of baseMigrations) {
            await run(
              "prisma",
              [
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
          await run(
            "prisma",
            ["migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
            options,
          )

          const deleted = await database.query(
            `SELECT learning_redaction_actor, learning_redacted_at
             FROM review_comments WHERE id = $1`,
            [commentId],
          )
          expect(deleted.rows).toEqual([
            { learning_redaction_actor: null, learning_redacted_at: null },
          ])
          const digest = `sha256:${"a".repeat(64)}`
          await expect(
            database.query(
              `INSERT INTO learning_runs
                 (id, repository_id, requested_by_id, requested_by_membership_id,
                  snapshot_digest, state, finished_at)
               VALUES ($1, $2, $3, $4, $5, 'SUCCEEDED', clock_timestamp())`,
              [randomUUID(), repositoryId, userId, membershipId, digest],
            ),
          ).rejects.toMatchObject({ code: "23514" })
          await expect(
            database.query(
              `INSERT INTO learning_runs
                 (id, repository_id, requested_by_id, requested_by_membership_id,
                  snapshot_digest, state, started_at, finished_at, failure_summary)
               VALUES ($1, $2, $3, $4, $5, 'FAILED', clock_timestamp(),
                       clock_timestamp(), 'failed')`,
              [randomUUID(), repositoryId, userId, membershipId, digest],
            ),
          ).rejects.toMatchObject({ code: "23514" })
        } finally {
          await database.end()
        }
      } finally {
        try {
          if (created) {
            await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
          }
        } finally {
          await admin.end()
        }
      }
    },
    timeoutMs,
  )

  it("preserves pending decisions while allowing edits and reinstatements", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_learning_actions_upgrade_${randomBytes(8).toString("hex")}`
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
        const migrationsRoot = join(hubRoot, "schema/migrations")
        const lastBaseMigration = "20261219120000_decision_agent_evaluations"
        const migration = "20261220120000_learning_decision_actions"
        const base = (await readdir(migrationsRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && entry.name <= lastBaseMigration)
          .map((entry) => entry.name)
          .sort()
        expect(base.at(-1)).toBe(lastBaseMigration)
        for (const migrationName of base) {
          const sql = await readFile(join(migrationsRoot, migrationName, "migration.sql"), "utf8")
          if (migrationName === "20261104190000_entra_oidc_authentication") {
            const statements = sql.split("\n")
            await database.query(statements.slice(0, 2).join("\n"))
            await database.query(statements.slice(2).join("\n"))
          } else {
            await database.query(sql)
          }
        }

        const repositoryId = randomUUID()
        const userId = randomUUID()
        const membershipId = randomUUID()
        const pendingId = randomUUID()
        await database.query(
          `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
          [repositoryId],
        )
        await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
        await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
          membershipId,
          userId,
        ])
        await database.query(
          `INSERT INTO learning_decision_operations
               (id, repository_id, actor_membership_id, learning_id, decision,
                created_at, updated_at)
             VALUES ($1, $2, $3, 'mem_pending', 'reject',
                     '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z')`,
          [pendingId, repositoryId, membershipId],
        )
        await expect(
          database.query(
            `INSERT INTO learning_decision_operations
                 (id, repository_id, actor_membership_id, learning_id, decision)
               VALUES ($1, $2, $3, 'mem_edit', 'edit')`,
            [randomUUID(), repositoryId, membershipId],
          ),
        ).rejects.toMatchObject({ code: "23514" })

        await database.query(
          await readFile(join(migrationsRoot, migration, "migration.sql"), "utf8"),
        )

        const pending = await database.query(
          `SELECT operation.id, operation.learning_id, operation.decision,
                    operation.created_at, operation.updated_at,
                    repository.id AS repository_id, membership.id AS membership_id,
                    membership.user_id
             FROM learning_decision_operations AS operation
             JOIN repositories AS repository ON repository.id = operation.repository_id
             JOIN memberships AS membership ON membership.id = operation.actor_membership_id
             WHERE operation.id = $1`,
          [pendingId],
        )
        expect(pending.rows).toEqual([
          {
            id: pendingId,
            learning_id: "mem_pending",
            decision: "reject",
            created_at: new Date("2026-10-01T10:00:00Z"),
            updated_at: new Date("2026-10-02T10:00:00Z"),
            repository_id: repositoryId,
            membership_id: membershipId,
            user_id: userId,
          },
        ])
        const editId = randomUUID()
        const reinstateId = randomUUID()
        await database.query(
          `INSERT INTO learning_decision_operations
               (id, repository_id, actor_membership_id, learning_id, decision)
             VALUES ($1, $3, $4, 'mem_edit', 'edit'),
                    ($2, $3, $4, 'mem_reinstate', 'reinstate')`,
          [editId, reinstateId, repositoryId, membershipId],
        )
        const inserted = await database.query(
          `SELECT id, decision FROM learning_decision_operations
             WHERE id = ANY($1::uuid[]) ORDER BY decision`,
          [[editId, reinstateId]],
        )
        expect(inserted.rows).toEqual([
          { id: editId, decision: "edit" },
          { id: reinstateId, decision: "reinstate" },
        ])
        await expect(
          database.query(
            `INSERT INTO learning_decision_operations
                 (id, repository_id, actor_membership_id, learning_id, decision)
               VALUES ($1, $2, $3, 'mem_unknown', 'unknown')`,
            [randomUUID(), repositoryId, membershipId],
          ),
        ).rejects.toMatchObject({
          code: "23514",
          constraint: "learning_decision_operations_decision_check",
        })
        await expect(
          database.query(
            `INSERT INTO learning_decision_operations
                 (id, repository_id, actor_membership_id, learning_id, decision)
               VALUES ($1, $2, $3, 'mem_missing_repository', 'edit')`,
            [randomUUID(), randomUUID(), membershipId],
          ),
        ).rejects.toMatchObject({ code: "23503" })
        await expect(
          database.query(
            `INSERT INTO learning_decision_operations
                 (id, repository_id, actor_membership_id, learning_id, decision)
               VALUES ($1, $2, $3, 'mem_missing_membership', 'reinstate')`,
            [randomUUID(), repositoryId, randomUUID()],
          ),
        ).rejects.toMatchObject({ code: "23503" })
      } finally {
        await database.end()
      }
    } finally {
      try {
        if (created) {
          await admin.query(`DROP DATABASE ${pg.escapeIdentifier(name)} WITH (FORCE)`)
        }
      } finally {
        await admin.end()
      }
    }
  }, 120_000)
})
