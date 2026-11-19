import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it, onTestFinished } from "vitest"

const migrationTestTimeoutMs = 60_000

describe("local Build pipeline migration", () => {
  it(
    "preserves existing prototype history and adds durable local Build records",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_local_build_upgrade_${randomBytes(8).toString("hex")}`
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
          const localBuildMigration = "20261202120000_local_build_pipeline"
          const base = await mkdtemp(join(tmpdir(), "replica-local-build-migrations-"))
          onTestFinished(() => rm(base, { recursive: true, force: true }))
          const baseMigrationsDirectory = join(base, "migrations")
          const baseConfig = join(base, "prisma.config.mjs")
          await mkdir(baseMigrationsDirectory)
          await writeFile(
            baseConfig,
            `export default {
              schema: ${JSON.stringify(join(hubRoot, "schema"))},
              migrations: { path: "migrations" },
              datasource: { url: process.env.DATABASE_URL },
            }\n`,
          )
          const baseMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < localBuildMigration)
            .map((entry) => entry.name)
          async function copyMigration(name: string) {
            await cp(join(migrationDirectory, name), join(baseMigrationsDirectory, name), {
              recursive: true,
            })
          }
          await Promise.all([...baseMigrations, "migration_lock.toml"].map(copyMigration))
          const run = promisify(execFile)
          const options = {
            cwd: hubRoot,
            env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
            timeout: migrationTestTimeoutMs,
          }
          async function deploy(config: string) {
            await run("prisma", ["migrate", "deploy", "--config", config], options)
          }
          await deploy(baseConfig)

          const repositoryId = randomUUID()
          const prototypeId = randomUUID()
          const buildId = randomUUID()
          const remoteRepositoryId = randomUUID()
          const remotePrototypeId = randomUUID()
          const remoteBuildId = randomUUID()
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/design', 'main')`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
             VALUES ($1, $2, 'prototype/welcome', 'Welcome', clock_timestamp())`,
            [prototypeId, repositoryId],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state, commit_sha, started_at)
             VALUES ($1, $2, 1, 'running', $3, clock_timestamp())`,
            [buildId, prototypeId, "a".repeat(40)],
          )

          await copyMigration(localBuildMigration)
          await deploy(baseConfig)
          await database.query(
            `UPDATE repositories SET local_path = '/workspace/design' WHERE id = $1`,
            [repositoryId],
          )
          await database.query(
            `INSERT INTO repositories (id, name_with_owner, default_branch)
             VALUES ($1, 'team/remote', 'main')`,
            [remoteRepositoryId],
          )
          await database.query(
            `INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at)
             VALUES ($1, $2, 'prototype/remote', 'Remote', clock_timestamp())`,
            [remotePrototypeId, remoteRepositoryId],
          )
          await database.query(
            `INSERT INTO builds (id, prototype_id, number, state, commit_sha, started_at)
             VALUES ($1, $2, 1, 'running', $3, clock_timestamp())`,
            [remoteBuildId, remotePrototypeId, "b".repeat(40)],
          )
          await deploy(join(hubRoot, "prisma7.config.ts"))

          expect(
            (
              await database.query(
                `SELECT name_with_owner, default_branch, local_path
                 FROM repositories WHERE id = $1`,
                [repositoryId],
              )
            ).rows,
          ).toEqual([
            {
              name_with_owner: "team/design",
              default_branch: "main",
              local_path: "/workspace/design",
            },
          ])
          expect(
            (
              await database.query(
                `SELECT state, started_at, local_lease_id, local_lease_expires_at
                 FROM builds WHERE id = $1`,
                [buildId],
              )
            ).rows,
          ).toEqual([
            {
              state: "queued",
              started_at: null,
              local_lease_id: null,
              local_lease_expires_at: null,
            },
          ])
          const remoteBuild = (
            await database.query<{
              state: string
              started_at: Date | null
              local_lease_id: string | null
              local_lease_expires_at: Date | null
            }>(
              `SELECT state, started_at, local_lease_id, local_lease_expires_at
               FROM builds WHERE id = $1`,
              [remoteBuildId],
            )
          ).rows[0]
          expect(remoteBuild).toMatchObject({
            state: "running",
            local_lease_id: null,
            local_lease_expires_at: null,
          })
          expect(remoteBuild?.started_at).toBeInstanceOf(Date)

          const observationId = randomUUID()
          await database.query(
            `INSERT INTO branch_head_observations
               (id, repository_id, build_id, branch_name, commit_sha)
             VALUES ($1, $2, $3, 'prototype/welcome', $4)`,
            [observationId, repositoryId, buildId, "a".repeat(40)],
          )
          const artifactId = randomUUID()
          await database.query(
            `INSERT INTO build_artifacts
               (id, build_id, kind, path, storage_key, byte_length)
             VALUES ($1, $2, 'screenshot', 'screenshots/desktop.png', 'build-artifact', 42)`,
            [artifactId, buildId],
          )
          await expect(
            database.query(
              `INSERT INTO branch_head_observations
                 (id, repository_id, build_id, branch_name, commit_sha)
               VALUES ($1, $2, $3, 'prototype/welcome', 'not-a-sha')`,
              [randomUUID(), repositoryId, buildId],
            ),
          ).rejects.toMatchObject({ code: "23514" })
          await expect(
            database.query(
              `INSERT INTO build_artifacts
                 (id, build_id, kind, path, storage_key, byte_length)
               VALUES ($1, $2, 'dist', 'dist/index.html', 'other-artifact', -1)`,
              [randomUUID(), buildId],
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
    migrationTestTimeoutMs,
  )
})
