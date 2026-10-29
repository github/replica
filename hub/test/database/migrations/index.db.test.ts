import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { describe, expect, it, onTestFinished } from "vitest"

describe("committed database migrations", () => {
  it("upgrades retained identity records and enforces administration lifecycle constraints", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")

    const databaseName = `replica_migration_${randomBytes(8).toString("hex")}`
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`)
    const databaseUrl = new URL(adminUrl)
    databaseUrl.pathname = databaseName
    const database = new pg.Client({ connectionString: databaseUrl.toString() })
    await database.connect()
    onTestFinished(async () => {
      await database.end()
      await admin.query(`DROP DATABASE ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`)
      await admin.end()
    })

    const initialMigration = await readFile(
      fileURLToPath(
        new URL(
          "../../../schema/migrations/20261026195151_identity/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    )
    const administrationMigration = await readFile(
      fileURLToPath(
        new URL(
          "../../../schema/migrations/20261027210000_membership_administration/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    )
    await database.query(initialMigration)
    await database.query(`
      INSERT INTO "users" ("id", "display_name")
      VALUES ('00000000-0000-4000-8000-000000000101', 'Suspended member');
      INSERT INTO "installation_memberships" ("id", "user_id", "status", "role", "source")
      VALUES (
        '00000000-0000-4000-8000-000000000102',
        '00000000-0000-4000-8000-000000000101',
        'suspended',
        'member',
        'manual'
      );
      INSERT INTO "security_audits" ("id", "event")
      VALUES
        ('00000000-0000-4000-8000-000000000103', 'authentication.admission_denied'),
        ('00000000-0000-4000-8000-000000000104', 'authentication.provider_failed'),
        ('00000000-0000-4000-8000-000000000105', 'session.sign_in');
    `)

    await database.query(administrationMigration)

    const membership = await database.query<{
      status: string
      suspendedAt: Date | null
      removedAt: Date | null
    }>(`
      SELECT
        "status",
        "suspended_at" AS "suspendedAt",
        "removed_at" AS "removedAt"
      FROM "installation_memberships"
      WHERE "id" = '00000000-0000-4000-8000-000000000102'
    `)
    expect(membership.rows[0]).toMatchObject({
      status: "suspended",
      removedAt: null,
    })
    expect(membership.rows[0]?.suspendedAt).toBeInstanceOf(Date)
    const audits = await database.query<{ event: string; outcome: string }>(`
      SELECT "event", "outcome"
      FROM "security_audits"
      ORDER BY "event"
    `)
    expect(audits.rows).toEqual([
      { event: "authentication.admission_denied", outcome: "denied" },
      { event: "authentication.provider_failed", outcome: "failed" },
      { event: "session.sign_in", outcome: "succeeded" },
    ])

    await expect(
      database.query(`
        UPDATE "installation_memberships"
        SET "status" = 'active'
        WHERE "id" = '00000000-0000-4000-8000-000000000102'
      `),
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      database.query(`
        UPDATE "installation_memberships"
        SET "status" = 'removed', "suspended_at" = NULL, "removed_at" = NULL
        WHERE "id" = '00000000-0000-4000-8000-000000000102'
      `),
    ).rejects.toMatchObject({ code: "23514" })
    await expect(
      database.query(`
        INSERT INTO "membership_invitations" (
          "id",
          "provider",
          "issuer",
          "subject",
          "role",
          "expires_at",
          "consumed_at",
          "revoked_at"
        )
        VALUES (
          '00000000-0000-4000-8000-000000000106',
          'github',
          'https://github.com',
          '42',
          'member',
          CURRENT_TIMESTAMP + INTERVAL '1 day',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `),
    ).rejects.toMatchObject({ code: "23514" })
  })
})
