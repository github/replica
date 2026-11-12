import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"

describe("Copilot connection foundation migration", () => {
  it("adds the singleton state when upgrading from the exact security-audit base", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_copilot_connection_upgrade_${randomBytes(8).toString("hex")}`
    const admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
    try {
      await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`)
      const databaseUrl = new URL(adminUrl)
      databaseUrl.pathname = name
      const database = new pg.Client({ connectionString: databaseUrl.toString() })
      await database.connect()
      try {
        const hubRoot = fileURLToPath(new URL("../../../", import.meta.url))
        const parentMigrations = [
          "20261029203000_identity_foundation",
          "20261030170000_authentication_proof",
          "20261102130000_hub_admission_sessions",
          "20261104190000_entra_oidc_authentication",
          "20261109130000_administrator_management_assignment_source",
          "20261109130100_administrator_management_authority",
          "20261109150000_administrator_authorization_purpose",
          "20261109160000_administrator_authorization_api",
          "20261110170000_security_audit_read_index",
          "20261110170013_prototype_index",
          "20261110190000_prototype_build_status",
        ]
        for (const migrationName of parentMigrations) {
          const migration = await readFile(
            join(hubRoot, "schema/migrations", migrationName, "migration.sql"),
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

        const prismaCli = join(hubRoot, "node_modules/prisma/build/index.js")
        const options = {
          cwd: hubRoot,
          env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
          timeout: 60_000,
        }
        for (const migrationName of parentMigrations) {
          await promisify(execFile)(
            process.execPath,
            [
              prismaCli,
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
        await promisify(execFile)(
          process.execPath,
          [prismaCli, "migrate", "deploy", "--config", join(hubRoot, "prisma7.config.ts")],
          options,
        )

        await expect(
          database.query(`SELECT key, generation FROM copilot_connection_states ORDER BY key`),
        ).resolves.toMatchObject({ rows: [{ generation: "0", key: "global" }] })
        await expect(
          database.query(
            `INSERT INTO copilot_connection_states (id, key) VALUES ($1, 'regional')`,
            [randomUUID()],
          ),
        ).rejects.toThrow()
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)

  it("enforces the deployment-wide singleton and bounded connection values", async () => {
    await expect(
      prisma.copilotConnectionState.findMany({
        select: { generation: true, key: true },
      }),
    ).resolves.toEqual([{ generation: 0n, key: "global" }])

    await expect(
      prisma.copilotConnectionState.create({
        data: { id: randomUUID(), key: "global" },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
    await expect(
      prisma.copilotConnectionState.create({
        data: { id: randomUUID(), key: "regional" },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.copilotConnectionState.update({
        where: { key: "global" },
        data: { generation: -1n },
      }),
    ).rejects.toThrow()

    const userId = randomUUID()
    const membershipId = randomUUID()
    await prisma.user.create({ data: { id: userId } })
    await prisma.membership.create({ data: { id: membershipId, userId } })
    const connection = {
      connectedByMembershipId: membershipId,
      id: randomUUID(),
      key: "global",
      tokenDigest: "a".repeat(64),
      verifiedAt: new Date("2026-11-10T23:00:00Z"),
    }
    await prisma.copilotConnection.create({ data: connection })

    await expect(
      prisma.copilotConnection.create({
        data: { ...connection, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
    await prisma.copilotConnection.delete({ where: { key: "global" } })
    await expect(
      prisma.copilotConnection.create({
        data: { ...connection, id: randomUUID(), key: "regional" },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.copilotConnection.create({
        data: { ...connection, id: randomUUID(), tokenDigest: "not-a-digest" },
      }),
    ).rejects.toThrow()
  })
})
