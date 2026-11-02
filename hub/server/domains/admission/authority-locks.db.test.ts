import { randomUUID } from "node:crypto"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { getDatabaseUrl } from "../../../test/database/get-database-url"

async function observeBlocked(inspector: pg.Client, pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await inspector.query<{ blocked: boolean }>(
      `SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked`,
      [pid],
    )
    if (result.rows[0]?.blocked) return true
    await Promise.resolve()
  }
  return false
}

describe("admission authority locks", () => {
  it("allows shared admission locks to overlap while provider mutation waits", async () => {
    const url = getDatabaseUrl()
    const first = new pg.Client({ connectionString: url })
    const second = new pg.Client({ connectionString: url })
    const updater = new pg.Client({ connectionString: url })
    const inspector = new pg.Client({ connectionString: url })
    await Promise.all([first.connect(), second.connect(), updater.connect(), inspector.connect()])
    const providerId = randomUUID()
    const revisionId = randomUUID()
    try {
      await first.query("BEGIN")
      await first.query(`INSERT INTO authentication_providers (id, key) VALUES ($1, 'github')`, [
        providerId,
      ])
      await first.query(
        `INSERT INTO authentication_provider_revisions
           (id, provider_id, revision, configuration_digest)
         VALUES ($1, $2, 1, $3)`,
        [revisionId, providerId, "a".repeat(64)],
      )
      await first.query(
        `UPDATE authentication_providers SET selected_revision_id = $1 WHERE id = $2`,
        [revisionId, providerId],
      )
      await first.query("COMMIT")

      await first.query("BEGIN")
      await first.query(`SELECT id FROM authentication_providers WHERE id = $1 FOR SHARE`, [
        providerId,
      ])
      await first.query(`SELECT id FROM session_revocation_states WHERE key = 'global' FOR SHARE`)

      await second.query("BEGIN")
      await expect(
        second.query(`SELECT id FROM authentication_providers WHERE id = $1 FOR SHARE`, [
          providerId,
        ]),
      ).resolves.toHaveProperty("rowCount", 1)
      await expect(
        second.query(`SELECT id FROM session_revocation_states WHERE key = 'global' FOR SHARE`),
      ).resolves.toHaveProperty("rowCount", 1)

      const updaterPid = await updater.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)
      await updater.query("BEGIN")
      const update = updater.query(
        `UPDATE authentication_providers
         SET updated_at = clock_timestamp()
         WHERE id = $1`,
        [providerId],
      )
      expect(await observeBlocked(inspector, updaterPid.rows[0]!.pid)).toBe(true)

      await first.query("COMMIT")
      await second.query("COMMIT")
      await expect(update).resolves.toHaveProperty("rowCount", 1)
      await updater.query("COMMIT")
    } finally {
      await Promise.allSettled([
        first.query("ROLLBACK"),
        second.query("ROLLBACK"),
        updater.query("ROLLBACK"),
      ])
      await Promise.all([first.end(), second.end(), updater.end(), inspector.end()])
    }
  })

  it("makes revocation mutation wait for shared admission authority locks", async () => {
    const url = getDatabaseUrl()
    const admission = new pg.Client({ connectionString: url })
    const updater = new pg.Client({ connectionString: url })
    const inspector = new pg.Client({ connectionString: url })
    await Promise.all([admission.connect(), updater.connect(), inspector.connect()])
    try {
      await admission.query("BEGIN")
      await admission.query(
        `SELECT id FROM session_revocation_states WHERE key = 'global' FOR SHARE`,
      )

      const updaterPid = await updater.query<{ pid: number }>(`SELECT pg_backend_pid() AS pid`)
      await updater.query("BEGIN")
      const update = updater.query(
        `UPDATE session_revocation_states
         SET revision = revision + 1, updated_at = clock_timestamp()
         WHERE key = 'global'`,
      )
      expect(await observeBlocked(inspector, updaterPid.rows[0]!.pid)).toBe(true)

      await admission.query("COMMIT")
      await expect(update).resolves.toHaveProperty("rowCount", 1)
      await updater.query("COMMIT")
    } finally {
      await Promise.allSettled([admission.query("ROLLBACK"), updater.query("ROLLBACK")])
      await Promise.all([admission.end(), updater.end(), inspector.end()])
    }
  })
})
