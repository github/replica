import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const migrationTestTimeoutMs = 60_000

describe("prototype Build status migration", () => {
  it(
    "preserves prototypes and enforces Build ownership after an upgrade",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_build_upgrade_${randomBytes(8).toString("hex")}`
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
          const buildStatusMigration = "20261110190000_prototype_build_status"
          const baseMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < buildStatusMigration)
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
          const firstPrototypeId = randomUUID()
          const secondPrototypeId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
             VALUES
               ($1, $3, 'prototype/first', 'First', clock_timestamp()),
               ($2, $3, 'prototype/second', 'Second', clock_timestamp())`,
            [firstPrototypeId, secondPrototypeId, repositoryId],
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

          const prototypes = await database.query(
            `SELECT id, repository_id, branch_name, name, current_build_id
             FROM prototypes WHERE repository_id = $1 ORDER BY branch_name`,
            [repositoryId],
          )
          expect(prototypes.rows).toEqual([
            {
              id: firstPrototypeId,
              repository_id: repositoryId,
              branch_name: "prototype/first",
              name: "First",
              current_build_id: null,
            },
            {
              id: secondPrototypeId,
              repository_id: repositoryId,
              branch_name: "prototype/second",
              name: "Second",
              current_build_id: null,
            },
          ])

          const buildId = randomUUID()
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state)
             VALUES ($1, $2, 1, 'successful')`,
            [buildId, firstPrototypeId],
          )
          const assigned = await database.query(
            `UPDATE prototypes SET current_build_id = $1 WHERE id = $2
             RETURNING current_build_id`,
            [buildId, firstPrototypeId],
          )
          expect(assigned.rows).toEqual([{ current_build_id: buildId }])
          await expect(
            database.query(`UPDATE prototypes SET current_build_id = $1 WHERE id = $2`, [
              buildId,
              secondPrototypeId,
            ]),
          ).rejects.toMatchObject({ code: "23503" })
          const cleared = await database.query(
            `UPDATE prototypes SET current_build_id = NULL WHERE id = $1
             RETURNING current_build_id`,
            [firstPrototypeId],
          )
          expect(cleared.rows).toEqual([{ current_build_id: null }])
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
