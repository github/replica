import { randomBytes, randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import pg from "pg"
import { expect, it } from "vitest"

import { getDatabaseUrl } from "../get-database-url"

const migrationName = "20261219120000_review_outcomes"

it("adds append-only review outcomes without changing existing resolution history", async () => {
  const url = new URL(getDatabaseUrl())
  const database = `replica_review_outcome_upgrade_${randomBytes(8).toString("hex")}`
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
        .filter(
          (entry) =>
            entry.isDirectory() && entry.name <= "20261218120000_github_build_run_completions",
        )
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
      const [
        repositoryId,
        prototypeId,
        sourceBuildId,
        resultBuildId,
        userId,
        threadId,
        resolutionId,
        outcomeId,
      ] = Array.from({ length: 8 }, () => randomUUID())
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
        "INSERT INTO builds (id, prototype_id, number, state) VALUES ($1, $3, 7, 'successful'), ($2, $3, 8, 'successful')",
        [sourceBuildId, resultBuildId, prototypeId],
      )
      await client.query(
        "INSERT INTO review_threads (id, repository_id, prototype_id, build_id, anchor, activity_version, collaboration_version, resolved_by_id, resolved_at) VALUES ($1, $2, $3, $4, $5, 2, 2, $6, now())",
        [threadId, repositoryId, prototypeId, sourceBuildId, { schemaVersion: 1 }, userId],
      )
      await client.query(
        "INSERT INTO review_thread_resolution_events (id, thread_id, actor_id, sequence, state, actor_login, occurred_at) VALUES ($1, $2, $3, 2, 'RESOLVED', 'reviewer', now())",
        [resolutionId, threadId, userId],
      )
      await client.query(
        await readFile(new URL(`${migrationName}/migration.sql`, migrations), "utf8"),
      )
      await client.query(
        `INSERT INTO review_outcomes
          (id, thread_id, build_id, verifier_id, resolution_event_id, sequence, kind, feedback_digest, verifier_login, verified_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'CONFIRMED_FIXED', $6, 'reviewer', now())`,
        [outcomeId, threadId, resultBuildId, userId, resolutionId, `sha256:${"a".repeat(64)}`],
      )
      expect(
        (
          await client.query(
            "SELECT sequence, state FROM review_thread_resolution_events WHERE thread_id = $1",
            [threadId],
          )
        ).rows,
      ).toEqual([{ sequence: 2, state: "RESOLVED" }])
      expect(
        (
          await client.query(
            "SELECT sequence, kind, build_id FROM review_outcomes WHERE thread_id = $1",
            [threadId],
          )
        ).rows,
      ).toEqual([{ sequence: 1, kind: "CONFIRMED_FIXED", build_id: resultBuildId }])
    } finally {
      await client.end()
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(database)} WITH (FORCE)`)
    }
  } finally {
    await admin.end()
  }
}, 30_000)
