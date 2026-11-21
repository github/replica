import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import pg from "pg"
import { expect, it } from "vitest"

interface RetainedOwner {
  github_repository_id: string
  id: string
  prototype_id: string
  number: number
  state: string
  github_workflow_run_id: string | null
  commit_sha: string | null
  artifact_id: string
  path: string
  storage_key: string
  byte_length: number
}

it("preserves duplicate preview owners and their artifacts when upgrading the exact base", async () => {
  const adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
  const name = `replica_preview_lookup_upgrade_${randomBytes(8).toString("hex")}`
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
      const migrations = join(hubRoot, "schema/migrations")
      const baseMigration = "20261219120000_decision_agent_evaluations"
      const base = (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name <= baseMigration)
        .map(({ name }) => name)
        .sort()
      expect(base.at(-1)).toBe(baseMigration)
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

      const repositoryId = randomUUID()
      const prototypeIds = [randomUUID(), randomUUID()]
      const buildIds = [randomUUID(), randomUUID()]
      await database.query(
        `INSERT INTO repositories (id, github_repository_id, name_with_owner, default_branch)
         VALUES ($1, 2001, 'team/previews', 'main')`,
        [repositoryId],
      )
      for (const [index, prototypeId] of prototypeIds.entries()) {
        await database.query(
          `INSERT INTO prototypes (id, repository_id, branch_name)
           VALUES ($1, $2, $3)`,
          [prototypeId, repositoryId, `proto/owner-${index}`],
        )
        await database.query(
          `INSERT INTO builds
             (id, prototype_id, number, state, github_workflow_run_id, commit_sha)
           VALUES ($1, $2, 1, 'successful', 3002, $3)`,
          [buildIds[index], prototypeId, "a".repeat(40)],
        )
        await database.query(
          `INSERT INTO build_artifacts (id, build_id, kind, path, storage_key, byte_length)
           VALUES ($1, $2, 'dist', 'dist/index.html', $3, 20)`,
          [randomUUID(), buildIds[index], `retained-preview-${index}`],
        )
      }
      async function retainedOwners() {
        return (
          await database.query<RetainedOwner>(
            `SELECT repository.github_repository_id, build.id, build.prototype_id,
                    build.number, build.state, build.github_workflow_run_id, build.commit_sha,
                    artifact.id AS artifact_id, artifact.path, artifact.storage_key,
                    artifact.byte_length
             FROM builds build
             JOIN prototypes prototype ON prototype.id = build.prototype_id
             JOIN repositories repository ON repository.id = prototype.repository_id
             JOIN build_artifacts artifact ON artifact.build_id = build.id
             WHERE repository.id = $1 ORDER BY build.id`,
            [repositoryId],
          )
        ).rows
      }
      const before = await retainedOwners()
      expect(before).toHaveLength(2)
      const run = promisify(execFile)
      const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
      const options = {
        cwd: hubRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        timeout: 120_000,
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
      expect(await retainedOwners()).toEqual(before)
      await database.query(
        `INSERT INTO builds
           (id, prototype_id, number, state, github_workflow_run_id, commit_sha)
         VALUES ($1, $2, 2, 'successful', 3002, $3)`,
        [randomUUID(), prototypeIds[0], "b".repeat(40)],
      )
      const owners = await database.query(
        `SELECT id FROM builds WHERE github_workflow_run_id = 3002`,
      )
      expect(owners.rows).toHaveLength(3)
      expect(await retainedOwners()).toEqual(before)
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
}, 120_000)
