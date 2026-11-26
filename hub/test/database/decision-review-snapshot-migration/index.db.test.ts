import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

const timeoutMs = 180_000
const baseMigration = "20261220150000_inbox_unread_lookup"

describe("decision review snapshot migration", () => {
  it(
    "preserves the populated base and keeps checkpoints unique to each repository",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_snapshot_upgrade_${randomBytes(8).toString("hex")}`
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
          const migrationsRoot = join(hubRoot, "schema/migrations")
          const names = (await readdir(migrationsRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()
          const checkpointMigrations = names.filter((name) =>
            name.endsWith("_add_decision_review_snapshot"),
          )
          expect(checkpointMigrations).toHaveLength(1)
          const checkpointMigration = checkpointMigrations[0]!
          const base = names.filter((name) => name <= baseMigration && name !== checkpointMigration)
          expect(base.at(-1)).toBe(baseMigration)
          expect(checkpointMigration > baseMigration).toBe(true)

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

          const retainedRepositoryId = randomUUID()
          const removedRepositoryId = randomUUID()
          const prototypeId = randomUUID()
          const runId = randomUUID()
          const reviewDigest = `sha256:${"a".repeat(64)}`
          await database.query(
            `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
             VALUES ($1, 1001, 'team/retained', 'main'), ($2, 1002, 'team/removed', 'main')`,
            [retainedRepositoryId, removedRepositoryId],
          )
          await database.query(
            `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
             VALUES ($1, $2, 'prototype/checkout', 'Checkout', '2026-11-18T12:00:00Z')`,
            [prototypeId, retainedRepositoryId],
          )
          await database.query(
            `INSERT INTO learning_runs
               (id, repository_id, snapshot_digest, state, started_at, finished_at)
             VALUES ($1, $2, $3, 'SUCCEEDED', '2026-11-18T12:01:00Z', '2026-11-18T12:02:00Z')`,
            [runId, retainedRepositoryId, reviewDigest],
          )
          async function retainedData() {
            const result = await database.query<{
              repository_id: string
              name_with_owner: string
              prototype_id: string
              name: string
              run_id: string
              state: string
              snapshot_digest: string
            }>(
              `SELECT repository.id AS repository_id, repository.name_with_owner,
                      prototype.id AS prototype_id, prototype.name,
                      run.id AS run_id, run.state, run.snapshot_digest
               FROM repositories repository
               JOIN prototypes prototype ON prototype.repository_id = repository.id
               JOIN learning_runs run ON run.repository_id = repository.id
               WHERE repository.id = $1`,
              [retainedRepositoryId],
            )
            return result.rows
          }
          const before = await retainedData()
          expect(before).toEqual([
            {
              repository_id: retainedRepositoryId,
              name_with_owner: "team/retained",
              prototype_id: prototypeId,
              name: "Checkout",
              run_id: runId,
              state: "SUCCEEDED",
              snapshot_digest: reviewDigest,
            },
          ])

          const run = promisify(execFile)
          const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: timeoutMs,
          }
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

          expect(await retainedData()).toEqual(before)
          expect(
            (
              await database.query(
                `SELECT migration_name FROM _prisma_migrations
                 WHERE migration_name = $1 AND finished_at IS NOT NULL`,
                [checkpointMigration],
              )
            ).rows,
          ).toEqual([{ migration_name: checkpointMigration }])
          expect((await database.query("SELECT id FROM decision_review_snapshots")).rows).toEqual(
            [],
          )

          const keptSnapshotId = randomUUID()
          const insert = `INSERT INTO decision_review_snapshots
                            (id, repository_id, digest, snapshot_id, captured_at)
                          VALUES ($1, $2, $3, $4, '2026-11-18T12:00:00Z')`
          await database.query(insert, [
            randomUUID(),
            removedRepositoryId,
            reviewDigest,
            randomUUID(),
          ])
          await expect(
            database.query(insert, [randomUUID(), removedRepositoryId, reviewDigest, randomUUID()]),
          ).rejects.toMatchObject({ code: "23505" })
          await database.query(insert, [
            randomUUID(),
            retainedRepositoryId,
            reviewDigest,
            keptSnapshotId,
          ])
          await database.query("DELETE FROM repositories WHERE id = $1", [removedRepositoryId])
          expect(
            (
              await database.query(
                "SELECT repository_id, snapshot_id FROM decision_review_snapshots",
              )
            ).rows,
          ).toEqual([{ repository_id: retainedRepositoryId, snapshot_id: keptSnapshotId }])
          expect(await retainedData()).toEqual(before)
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
    timeoutMs,
  )
})
