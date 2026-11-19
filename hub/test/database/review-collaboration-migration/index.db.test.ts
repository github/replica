import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import pg from "pg"
import { expect, it } from "vitest"

import { getDatabaseUrl } from "../get-database-url"

const migrationName = "20261203140000_review_collaboration"

it("upgrades the base review history without changing its source body or inventing Inbox activity", async () => {
  const url = new URL(getDatabaseUrl())
  const database = `replica_review_upgrade_${randomBytes(8).toString("hex")}`
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`)
    url.pathname = database
    const client = new pg.Client({ connectionString: url.toString() })
    try {
      await client.connect()
      const migrations = new URL("../../../schema/migrations/", import.meta.url)
      const base = (await readdir(migrations, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name <= "20261203130000_local_build_leases")
        .map(({ name }) => name)
        .sort()
      for (const name of base) {
        const sql = await readFile(new URL(`${name}/migration.sql`, migrations), "utf8")
        if (name === "20261104190000_entra_oidc_authentication") {
          const statements = sql.split("\n")
          await client.query(statements.slice(0, 2).join("\n"))
          await client.query(statements.slice(2).join("\n"))
        } else {
          await client.query(sql)
        }
      }
      const [repositoryId, prototypeId, buildId, userId, threadId, commentId] = Array.from(
        { length: 6 },
        () => randomUUID(),
      )
      await client.query("INSERT INTO users (id) VALUES ($1)", [userId])
      await client.query(
        "INSERT INTO repositories (id, name_with_owner, default_branch) VALUES ($1, 'example/review', 'main')",
        [repositoryId],
      )
      await client.query(
        "INSERT INTO prototypes (id, repository_id, branch_name, name, registered_at) VALUES ($1, $2, 'prototype/example', 'Example', now())",
        [prototypeId, repositoryId],
      )
      await client.query(
        "INSERT INTO builds (id, prototype_id, number, state) VALUES ($1, $2, 7, 'successful')",
        [buildId, prototypeId],
      )
      await client.query(
        "INSERT INTO review_threads (id, repository_id, prototype_id, build_id, anchor, activity_version) VALUES ($1, $2, $3, $4, $5, 3)",
        [threadId, repositoryId, prototypeId, buildId, { schemaVersion: 1 }],
      )
      const body = "Original @collaborator body stays intact."
      await client.query(
        "INSERT INTO review_comments (id, thread_id, author_id, author_login, body) VALUES ($1, $2, $3, 'author', $4)",
        [commentId, threadId, userId, body],
      )
      await client.query(
        await readFile(new URL(`${migrationName}/migration.sql`, migrations), "utf8"),
      )
      const [thread] = (
        await client.query<{
          build_id: string
          activity_version: number
          collaboration_version: number
          body: string
        }>(
          `SELECT build_id, activity_version, collaboration_version, body
           FROM review_threads JOIN review_comments ON thread_id = review_threads.id
          WHERE review_threads.id = $1`,
          [threadId],
        )
      ).rows
      expect(thread).toEqual({
        build_id: buildId,
        activity_version: 3,
        collaboration_version: 3,
        body,
      })
      expect((await client.query("SELECT public_id FROM review_notifications")).rows).toEqual([])
    } finally {
      await client.end()
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(database)} WITH (FORCE)`)
    }
  } finally {
    await admin.end()
  }
}, 30_000)
