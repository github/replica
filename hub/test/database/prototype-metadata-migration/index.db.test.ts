import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 60_000

describe("prototype metadata migration", () => {
  it(
    "clears legacy blanks without changing valid metadata or prototype and Build identity",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_metadata_upgrade_${randomBytes(8).toString("hex")}`
      const admin = new pg.Client({ connectionString: adminUrl })
      await admin.connect()
      let created = false
      try {
        await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
        created = true
        const databaseUrl = new URL(adminUrl)
        databaseUrl.pathname = name
        const database = new pg.Client({ connectionString: databaseUrl.toString() })
        try {
          await database.connect()
          const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
          const migrationDirectory = join(hubRoot, "schema/migrations")
          const metadataMigration = "20261114150000_prototype_metadata"
          const parentMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < metadataMigration)
            .map(({ name }) => name)
            .sort()
          for (const migrationName of parentMigrations) {
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
          const authorId = randomUUID()
          const draftId = randomUUID()
          const registeredId = randomUUID()
          const draftBuildId = randomUUID()
          const registeredBuildId = randomUUID()
          const whitespace =
            "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
           VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [authorId])
          await database.query(
            `INSERT INTO prototypes
             (id, repository_id, branch_name, name, description, author_id, registered_at)
           VALUES
             ($1, $3, 'prototype/draft', $4, $4, NULL, NULL),
             ($2, $3, 'prototype/normal', 'Welcome', $5, $6, '2026-10-01T00:00:00Z')`,
            [
              draftId,
              registeredId,
              repositoryId,
              whitespace,
              "A useful\u00a0description",
              authorId,
            ],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state, commit_sha)
           VALUES
             ($1, $2, 2, 'successful', $3),
             ($4, $5, 7, 'successful', $6)`,
            [
              draftBuildId,
              draftId,
              "a".repeat(40),
              registeredBuildId,
              registeredId,
              "b".repeat(40),
            ],
          )
          await database.query(
            `UPDATE prototypes
           SET current_build_id = builds.id, updated_at = clock_timestamp()
           FROM builds WHERE prototypes.id = builds.prototype_id`,
          )
          const prototypeQuery = `
          SELECT id, repository_id, branch_name, name, description, author_id,
                 registered_at, current_build_id, created_at
          FROM prototypes WHERE repository_id = $1 ORDER BY branch_name`
          const buildQuery = `
          SELECT id, prototype_id, number, state, commit_sha FROM builds ORDER BY id`
          const prototypesBefore = await database.query<Record<string, unknown>>(prototypeQuery, [
            repositoryId,
          ])
          const buildsBefore = await database.query(buildQuery)

          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
          }
          const run = promisify(execFile)
          for (const migrationName of parentMigrations) {
            await run(
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
          await run(
            process.execPath,
            [prismaCli, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
            options,
          )

          const prototypesAfter = await database.query(prototypeQuery, [repositoryId])
          expect(prototypesAfter.rows).toEqual([
            { ...prototypesBefore.rows[0], name: null, description: null },
            prototypesBefore.rows[1],
          ])
          const buildsAfter = await database.query(buildQuery)
          expect(buildsAfter.rows).toEqual(buildsBefore.rows)
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
