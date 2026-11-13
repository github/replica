import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 60_000

describe("review comments migration", () => {
  it(
    "preserves product records and creates scoped conversation history",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_review_comments_upgrade_${randomBytes(8).toString("hex")}`
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
          const reviewMigration = "20261113170000_review_comment_backend"
          const baseMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < reviewMigration)
            .map((entry) => entry.name)
            .sort()
          for (const migrationName of baseMigrations) {
            const migration = await readFile(
              join(migrationDirectory, migrationName, "migration.sql"),
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

          const repositoryId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const userId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
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

          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
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

          const prototype = await database.query(
            `SELECT id, repository_id, branch_name, name
             FROM prototypes WHERE id = $1`,
            [prototypeId],
          )
          expect(prototype.rows).toEqual([
            {
              id: prototypeId,
              repository_id: repositoryId,
              branch_name: "prototype/checkout",
              name: "Checkout",
            },
          ])

          const threadId = randomUUID()
          const rootId = randomUUID()
          const replyId = randomUUID()
          await database.query(
            `INSERT INTO review_threads
               (id, repository_id, prototype_id, build_id, anchor)
             VALUES ($1, $2, $3, $4, '{"kind":"element"}')`,
            [threadId, repositoryId, prototypeId, buildId],
          )
          const root = await database.query<{ public_id: number }>(
            `INSERT INTO review_comments
               (id, thread_id, author_id, author_login, body)
             VALUES ($1, $2, $3, 'mona', 'Please align this section.')
             RETURNING public_id`,
            [rootId, threadId, userId],
          )
          const rootPublicId = root.rows[0]?.public_id
          expect(rootPublicId).toEqual(expect.any(Number))
          await database.query(
            `INSERT INTO review_comments
               (id, thread_id, root_id, author_id, author_login, body)
             VALUES ($1, $2, $3, $4, 'mona', 'Reply text')`,
            [replyId, threadId, rootId, userId],
          )
          await database.query(
            `INSERT INTO review_thread_resolution_events
               (id, thread_id, actor_id, sequence, state, actor_login, occurred_at)
             VALUES ($1, $2, $3, 2, 'RESOLVED', 'mona', clock_timestamp())`,
            [randomUUID(), threadId, userId],
          )
          await expect(
            database.query(
              `INSERT INTO review_comments
                 (id, thread_id, author_id, author_login, body)
               VALUES ($1, $2, $3, 'mona', 'Second root')`,
              [randomUUID(), threadId, userId],
            ),
          ).rejects.toMatchObject({ code: "23505" })
          await database.query(
            `UPDATE review_comments
             SET body = NULL, edited_at = NULL, deleted_at = clock_timestamp()
             WHERE id = $1`,
            [replyId],
          )
          const deleted = await database.query<{
            public_id: number
            body: string | null
            deleted_at: Date | null
          }>(
            `SELECT public_id, body, deleted_at
             FROM review_comments WHERE id = $1`,
            [replyId],
          )
          expect(deleted.rows).toHaveLength(1)
          expect(Number.isInteger(deleted.rows[0]?.public_id)).toBe(true)
          expect(deleted.rows[0]?.body).toBeNull()
          expect(deleted.rows[0]?.deleted_at).toBeInstanceOf(Date)
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
    migrationTestTimeoutMs,
  )
})
