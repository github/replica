import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

describe("prototype introductions migration", () => {
  it("preserves existing authors and prototypes and rejects duplicate introductions", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_introductions_upgrade_${randomBytes(8).toString("hex")}`
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
        const introductionMigration = "20261201140000_prototype_introductions"
        const base = (await readdir(migrations, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && entry.name < introductionMigration)
          .map(({ name }) => name)
          .sort()
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
        const userId = randomUUID()
        const repositoryId = randomUUID()
        const prototypeId = randomUUID()
        await database.query("INSERT INTO users (id) VALUES ($1)", [userId])
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
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        const run = promisify(execFile)
        for (const migrationName of base) {
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
        const existing = await database.query(
          `SELECT prototype.id, prototype.branch_name, prototype.name, author.id AS author_id
           FROM prototypes prototype JOIN users author ON author.id = prototype.author_id
           WHERE prototype.id = $1`,
          [prototypeId],
        )
        expect(existing.rows).toEqual([
          {
            id: prototypeId,
            branch_name: "prototype/welcome",
            name: "Welcome",
            author_id: userId,
          },
        ])
        expect((await database.query("SELECT id FROM prototype_introductions")).rows).toEqual([])
        const insert = `INSERT INTO prototype_introductions (id, user_id, prototype_id)
                        VALUES ($1, $2, $3)`
        await database.query(insert, [randomUUID(), userId, prototypeId])
        await expect(
          database.query(insert, [randomUUID(), userId, prototypeId]),
        ).rejects.toMatchObject({ code: "23505" })
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
  }, 60_000)
})
