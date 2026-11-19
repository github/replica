import { randomUUID } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import pg from "pg"
import { expect, it } from "vitest"

const migrationPath = new URL("../../../schema/migrations/", import.meta.url)
const baseMigration = "20261203130000_local_build_leases"
const hostedMigration = "20261203150000_hosted_build_sharing"

function readMigration(name: string) {
  return readFile(new URL(`${name}/migration.sql`, migrationPath), "utf8")
}

it("preserves the local opt-in and pinned share link when upgrading the sharing schema", async () => {
  const adminUrl = process.env.TEST_DATABASE_URL!
  const name = `replica_sharing_upgrade_${randomUUID().replaceAll("-", "")}`
  const databaseName = pg.escapeIdentifier(name)
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE ${databaseName}`)
    try {
      const databaseUrl = new URL(adminUrl)
      databaseUrl.pathname = name
      const database = new pg.Client({ connectionString: databaseUrl.toString() })
      await database.connect()
      try {
        const base = (await readdir(migrationPath, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && entry.name <= baseMigration)
          .map(({ name }) => name)
          .sort()
        for (const migrationName of base) {
          const migration = await readMigration(migrationName)
          if (migrationName === "20261104190000_entra_oidc_authentication") {
            const statements = migration.split("\n")
            await database.query(statements.slice(0, 2).join("\n"))
            await database.query(statements.slice(2).join("\n"))
          } else {
            await database.query(migration)
          }
        }

        const [repositoryId, prototypeId, buildId, userId, linkId, publicId, policyId] = Array.from(
          { length: 7 },
          () => randomUUID(),
        )
        await database.query(
          `INSERT INTO repositories (id, name_with_owner, default_branch, local_path)
           VALUES ($1, 'local/design', 'main', '/design')`,
          [repositoryId],
        )
        await database.query(
          `INSERT INTO prototypes (id, repository_id, branch_name) VALUES ($1, $2, 'welcome')`,
          [prototypeId, repositoryId],
        )
        await database.query(
          `INSERT INTO builds (id, prototype_id, state, number) VALUES ($1, $2, 'successful', 1)`,
          [buildId, prototypeId],
        )
        await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
        await database.query(
          `INSERT INTO sharing_settings (id, key, public_sharing_enabled, revision)
           VALUES ($1, 'public-sharing', true, 1)`,
          [policyId],
        )
        await database.query(
          `INSERT INTO share_links
             (id, prototype_id, build_id, created_by_id, public_id, label, created_by_login, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'Review', 'developer', now() + interval '1 day')`,
          [linkId, prototypeId, buildId, userId, publicId],
        )

        await database.query(await readMigration(hostedMigration))
        const link = await database.query(
          `SELECT public_id, build_id, revoked_at, created_by_external_identity_id
           FROM share_links WHERE id = $1`,
          [linkId],
        )
        expect(link.rows).toEqual([
          {
            public_id: publicId,
            build_id: buildId,
            revoked_at: null,
            created_by_external_identity_id: null,
          },
        ])
        const setting = await database.query(
          `SELECT public_sharing_enabled, revision FROM sharing_settings WHERE id = $1`,
          [policyId],
        )
        expect(setting.rows).toEqual([{ public_sharing_enabled: true, revision: 1 }])
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`)
    }
  } finally {
    await admin.end()
  }
}, 30_000)
