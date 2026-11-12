import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it, onTestFinished } from "vitest"

import { prisma } from "../../../server/integrations/prisma"
import { getDatabaseUrl } from "../get-database-url"

const migrationTestTimeoutMs = 60_000

describe("Build metadata", () => {
  it(
    "preserves existing Builds and leaves their metadata unknown when upgrading",
    async () => {
      const adminUrl = process.env.TEST_DATABASE_URL
      if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
      const name = `replica_build_metadata_upgrade_${randomBytes(8).toString("hex")}`
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
          const metadataMigration = "20261112190000_build_detail_metadata"
          const baseMigrations = (await readdir(migrationDirectory, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name < metadataMigration)
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
          const firstBuildId = randomUUID()
          const secondBuildId = randomUUID()
          const workflowCreatedAt = new Date("2026-10-01T10:00:00Z")
          const firstCreatedAt = new Date("2026-10-01T10:01:00Z")
          const firstUpdatedAt = new Date("2026-10-01T10:02:00Z")
          const secondCreatedAt = new Date("2026-10-02T10:01:00Z")
          const secondUpdatedAt = new Date("2026-10-02T10:02:00Z")
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
            `INSERT INTO builds
               (id, prototype_id, number, state, workflow_created_at, created_at, updated_at)
             VALUES
               ($1, $3, 4, 'successful', $4, $5, $6),
               ($2, $3, 9, 'failed', NULL, $7, $8)`,
            [
              firstBuildId,
              secondBuildId,
              prototypeId,
              workflowCreatedAt,
              firstCreatedAt,
              firstUpdatedAt,
              secondCreatedAt,
              secondUpdatedAt,
            ],
          )
          await database.query(`UPDATE prototypes SET current_build_id = $1 WHERE id = $2`, [
            firstBuildId,
            prototypeId,
          ])

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

          const unknownMetadata = {
            commit_sha: null,
            commit_author_provider: null,
            commit_author_issuer: null,
            commit_author_provider_user_id: null,
            commit_author_login: null,
            commit_author_name: null,
            commit_author_avatar_url: null,
            started_at: null,
            finished_at: null,
            failure_summary: null,
          }
          const builds = await database.query(
            `SELECT id, prototype_id, number, state, workflow_created_at, created_at, updated_at,
                    commit_sha, commit_author_provider, commit_author_issuer,
                    commit_author_provider_user_id, commit_author_login, commit_author_name,
                    commit_author_avatar_url, started_at, finished_at, failure_summary
             FROM builds WHERE prototype_id = $1 ORDER BY number`,
            [prototypeId],
          )
          expect(builds.rows).toEqual([
            {
              id: firstBuildId,
              prototype_id: prototypeId,
              number: 4,
              state: "successful",
              workflow_created_at: workflowCreatedAt,
              created_at: firstCreatedAt,
              updated_at: firstUpdatedAt,
              ...unknownMetadata,
            },
            {
              id: secondBuildId,
              prototype_id: prototypeId,
              number: 9,
              state: "failed",
              workflow_created_at: null,
              created_at: secondCreatedAt,
              updated_at: secondUpdatedAt,
              ...unknownMetadata,
            },
          ])
          const prototype = await database.query(
            `SELECT repository_id, branch_name, name, current_build_id
             FROM prototypes WHERE id = $1`,
            [prototypeId],
          )
          expect(prototype.rows).toEqual([
            {
              repository_id: repositoryId,
              branch_name: "prototype/welcome",
              name: "Welcome",
              current_build_id: firstBuildId,
            },
          ])
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

  it("round-trips an external commit author and permits an author name without an account", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/welcome" },
    })
    const metadata = {
      commitSha: "a".repeat(40),
      commitAuthorProvider: "github",
      commitAuthorIssuer: "https://github.com",
      commitAuthorProviderUserId: "external-account-42",
      commitAuthorLogin: "example-author",
      commitAuthorName: "Example Author",
      commitAuthorAvatarUrl: "https://example.test/avatar.png",
      startedAt: new Date("2026-11-12T10:00:00Z"),
      finishedAt: new Date("2026-11-12T10:05:00Z"),
      failureSummary: "An example Build failed.",
    }
    const build = await prisma.build.create({
      data: { prototypeId: prototype.id, number: 1, state: "failed", ...metadata },
    })

    expect(await prisma.build.findUniqueOrThrow({ where: { id: build.id } })).toMatchObject(
      metadata,
    )
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    onTestFinished(() => database.end())
    const stored = await database.query(
      `SELECT commit_sha, commit_author_provider, commit_author_issuer,
              commit_author_provider_user_id, commit_author_login, commit_author_name,
              commit_author_avatar_url, started_at, finished_at, failure_summary
       FROM builds WHERE id = $1`,
      [build.id],
    )
    expect(stored.rows).toEqual([
      {
        commit_sha: metadata.commitSha,
        commit_author_provider: metadata.commitAuthorProvider,
        commit_author_issuer: metadata.commitAuthorIssuer,
        commit_author_provider_user_id: metadata.commitAuthorProviderUserId,
        commit_author_login: metadata.commitAuthorLogin,
        commit_author_name: metadata.commitAuthorName,
        commit_author_avatar_url: metadata.commitAuthorAvatarUrl,
        started_at: metadata.startedAt,
        finished_at: metadata.finishedAt,
        failure_summary: metadata.failureSummary,
      },
    ])

    const nameOnly = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 2,
        commitAuthorName: "Author Without Account",
      },
    })
    expect(nameOnly).toMatchObject({
      commitAuthorProvider: null,
      commitAuthorIssuer: null,
      commitAuthorProviderUserId: null,
      commitAuthorName: "Author Without Account",
    })
  })

  it("rejects incomplete or blank external author identities", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/welcome" },
    })
    const build = await prisma.build.create({ data: { prototypeId: prototype.id, number: 1 } })
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    onTestFinished(() => database.end())

    const invalidIdentities = [
      ["missing provider", null, "https://github.com", "external-42"],
      ["missing issuer", "github", null, "external-42"],
      ["missing provider user ID", "github", "https://github.com", null],
      ["provider alone", "github", null, null],
      ["issuer alone", null, "https://github.com", null],
      ["provider user ID alone", null, null, "external-42"],
      ["blank provider", " \t ", "https://github.com", "external-42"],
      ["blank issuer", "github", "  ", "external-42"],
      ["blank provider user ID", "github", "https://github.com", "\n"],
    ]
    for (const [label, provider, issuer, providerUserId] of invalidIdentities) {
      await expect(
        database.query(
          `UPDATE builds SET
             commit_author_provider = $2, commit_author_issuer = $3,
             commit_author_provider_user_id = $4
           WHERE id = $1`,
          [build.id, provider, issuer, providerUserId],
        ),
        label ?? undefined,
      ).rejects.toMatchObject({ code: "23514" })
    }
  })

  it("keeps known commit SHAs canonical and unique within each prototype", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const first = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/first" },
    })
    const second = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/second" },
    })
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    onTestFinished(() => database.end())
    const sha = "b".repeat(40)
    await database.query(
      `INSERT INTO builds (id, prototype_id, number, commit_sha)
       VALUES ($1, $5, 1, NULL), ($2, $5, 2, NULL), ($3, $5, 3, $7), ($4, $6, 1, $7)`,
      [randomUUID(), randomUUID(), randomUUID(), randomUUID(), first.id, second.id, sha],
    )
    await database.query(
      `INSERT INTO builds (id, prototype_id, number, commit_sha) VALUES ($1, $2, 4, $3)`,
      [randomUUID(), first.id, "c".repeat(64)],
    )

    await expect(
      database.query(
        `INSERT INTO builds (id, prototype_id, number, commit_sha) VALUES ($1, $2, 5, $3)`,
        [randomUUID(), first.id, sha],
      ),
    ).rejects.toMatchObject({ code: "23505" })
    for (const invalidSha of ["B".repeat(40), "c".repeat(39), "g".repeat(40)]) {
      await expect(
        database.query(
          `INSERT INTO builds (id, prototype_id, number, commit_sha) VALUES ($1, $2, 5, $3)`,
          [randomUUID(), first.id, invalidSha],
        ),
      ).rejects.toMatchObject({ code: "23514" })
    }
  })

  it("keeps populated timestamps consistent with the Build state", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/welcome" },
    })
    const build = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "running",
        startedAt: new Date("2026-11-12T10:00:00Z"),
      },
    })
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    onTestFinished(() => database.end())

    await expect(
      database.query(`UPDATE builds SET state = 'successful' WHERE id = $1`, [build.id]),
    ).rejects.toMatchObject({ code: "23514" })
    await database.query(`UPDATE builds SET state = 'successful', finished_at = $2 WHERE id = $1`, [
      build.id,
      new Date("2026-11-12T10:05:00Z"),
    ])
  })

  it("accepts bounded failure summaries only for failed Builds", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/design", defaultBranch: "main" },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "prototype/welcome" },
    })
    const build = await prisma.build.create({ data: { prototypeId: prototype.id, number: 1 } })
    const database = new pg.Client({ connectionString: getDatabaseUrl() })
    await database.connect()
    onTestFinished(() => database.end())

    await expect(
      database.query(
        `UPDATE builds SET state = 'running', failure_summary = 'Example failure'
         WHERE id = $1`,
        [build.id],
      ),
    ).rejects.toMatchObject({ code: "23514" })
    await database.query(
      `UPDATE builds SET state = 'failed', failure_summary = ' ' WHERE id = $1`,
      [build.id],
    )
    const maximumSummary = "é".repeat(500)
    await database.query(`UPDATE builds SET failure_summary = $2 WHERE id = $1`, [
      build.id,
      maximumSummary,
    ])
    for (const summary of ["", `${maximumSummary}x`]) {
      await expect(
        database.query(`UPDATE builds SET failure_summary = $2 WHERE id = $1`, [build.id, summary]),
      ).rejects.toMatchObject({ code: "23514" })
    }
    await expect(
      database.query(`UPDATE builds SET state = 'successful' WHERE id = $1`, [build.id]),
    ).rejects.toMatchObject({ code: "23514" })
    await database.query(
      `UPDATE builds SET state = 'successful', failure_summary = NULL WHERE id = $1`,
      [build.id],
    )
  })
})
