import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import pg from "pg"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"

async function createMembership() {
  const userId = randomUUID()
  const externalIdentityId = randomUUID()
  const membershipId = randomUUID()
  await prisma.user.create({ data: { id: userId } })
  await prisma.externalIdentity.create({
    data: {
      id: externalIdentityId,
      issuer: "https://github.com",
      provider: "github",
      subject: randomUUID(),
      userId,
    },
  })
  await prisma.membership.create({ data: { id: membershipId, userId } })
  return { externalIdentityId, membershipId }
}

describe("administrator management database authority", () => {
  it("rejects duplicate active administrator-managed assignments", async () => {
    const membership = await createMembership()
    const assignment = {
      externalIdentityId: membership.externalIdentityId,
      membershipId: membership.membershipId,
      role: "ADMINISTRATOR" as const,
      source: "HUB_ADMINISTRATOR" as const,
    }
    await prisma.membershipAssignment.create({
      data: { ...assignment, id: randomUUID() },
    })

    await expect(
      prisma.membershipAssignment.create({
        data: { ...assignment, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("rejects administrator-managed member roles and provider provenance", async () => {
    const membership = await createMembership()
    const providerId = randomUUID()
    const providerRevisionId = randomUUID()
    await prisma.authenticationProvider.create({
      data: { enabled: false, id: providerId, key: randomUUID() },
    })
    await prisma.authenticationProviderRevision.create({
      data: {
        configurationDigest: "a".repeat(64),
        id: providerRevisionId,
        providerId,
        revision: 1,
      },
    })

    await expect(
      prisma.membershipAssignment.create({
        data: {
          externalIdentityId: membership.externalIdentityId,
          id: randomUUID(),
          membershipId: membership.membershipId,
          role: "MEMBER",
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.membershipAssignment.create({
        data: {
          externalIdentityId: membership.externalIdentityId,
          id: randomUUID(),
          membershipId: membership.membershipId,
          providerAssignmentSubject: randomUUID(),
          providerRevisionId,
          role: "ADMINISTRATOR",
          source: "HUB_ADMINISTRATOR",
        },
      }),
    ).rejects.toThrow()
  })

  it("forbids reactivating a revoked administrator-managed assignment", async () => {
    const membership = await createMembership()
    const assignmentId = randomUUID()
    await prisma.membershipAssignment.create({
      data: {
        createdAt: new Date("2026-01-01T00:00:00Z"),
        externalIdentityId: membership.externalIdentityId,
        id: assignmentId,
        membershipId: membership.membershipId,
        role: "ADMINISTRATOR",
        source: "HUB_ADMINISTRATOR",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    })
    await prisma.membershipAssignment.update({
      data: {
        lifecycle: "REVOKED",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
      where: { id: assignmentId },
    })

    await expect(
      prisma.membershipAssignment.update({
        data: {
          lifecycle: "ACTIVE",
          updatedAt: new Date("2026-01-03T00:00:00Z"),
        },
        where: { id: assignmentId },
      }),
    ).rejects.toThrow("Administrator-managed assignments may only be revoked")
  })
})

describe("administrator management migration compatibility", () => {
  it("upgrades the exact Entra base without changing bootstrap or provider assignments", async () => {
    const adminUrl = process.env.TEST_DATABASE_URL
    if (!adminUrl) throw new Error("TEST_DATABASE_URL is required.")
    const name = `replica_administrator_upgrade_${randomBytes(8).toString("hex")}`
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

        const providerId = randomUUID()
        const providerRevisionId = randomUUID()
        await database.query(
          `INSERT INTO authentication_providers (id, key, enabled)
           VALUES ($1, 'entra', false)`,
          [providerId],
        )
        await database.query(
          `INSERT INTO authentication_provider_revisions
             (id, provider_id, revision, configuration_digest)
           VALUES ($1, $2, 1, $3)`,
          [providerRevisionId, providerId, "a".repeat(64)],
        )
        await database.query(
          `UPDATE authentication_providers
           SET enabled = true, selected_revision_id = $1
           WHERE id = $2`,
          [providerRevisionId, providerId],
        )

        for (const [source, role, providerRevision] of [
          ["BOOTSTRAP", "ADMINISTRATOR", null],
          ["AUTHENTICATION_PROVIDER", "MEMBER", providerRevisionId],
        ] as const) {
          const userId = randomUUID()
          const identityId = randomUUID()
          const membershipId = randomUUID()
          await database.query(`INSERT INTO users (id) VALUES ($1)`, [userId])
          await database.query(
            `INSERT INTO external_identities
               (id, user_id, provider, issuer, subject)
             VALUES ($1, $2, 'entra', 'https://issuer.example.test', $3)`,
            [identityId, userId, randomUUID()],
          )
          await database.query(`INSERT INTO memberships (id, user_id) VALUES ($1, $2)`, [
            membershipId,
            userId,
          ])
          await database.query(
            `INSERT INTO membership_assignments
               (id, membership_id, external_identity_id, provider_revision_id,
                source, role, provider_assignment_subject)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              membershipId,
              identityId,
              providerRevision,
              source,
              role,
              providerRevision ? randomUUID() : null,
            ],
          )
        }
        const before = await database.query(
          `SELECT
             membership_id,
             external_identity_id,
             provider_revision_id,
             source::text,
             role::text,
             lifecycle::text,
             provider_assignment_subject
           FROM membership_assignments
           ORDER BY source`,
        )

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

        const after = await database.query(
          `SELECT
             membership_id,
             external_identity_id,
             provider_revision_id,
             source::text,
             role::text,
             lifecycle::text,
             provider_assignment_subject
           FROM membership_assignments
           ORDER BY source`,
        )
        expect(after.rows).toEqual(before.rows)
        await expect(
          database.query(
            `SELECT 'HUB_ADMINISTRATOR'::"MembershipAssignmentSource"::text AS source`,
          ),
        ).resolves.toMatchObject({ rows: [{ source: "HUB_ADMINISTRATOR" }] })
      } finally {
        await database.end()
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(name)} WITH (FORCE)`)
      await admin.end()
    }
  }, 30_000)
})
