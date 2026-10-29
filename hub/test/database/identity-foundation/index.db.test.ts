import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"
import { createExternalIdentity } from "../../../server/repositories/external-identities/create-external-identity"
import { createUser } from "../../../server/repositories/users/create-user"

describe("identity foundation migration", () => {
  it("deploys the committed baseline with only C1 application tables", async () => {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY started_at
    `
    const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `

    expect(migrations).toEqual([{ migration_name: "20261029203000_identity_foundation" }])
    expect(tables).toEqual([
      { table_name: "authentication_provider_revisions" },
      { table_name: "authentication_providers" },
      { table_name: "external_identities" },
      { table_name: "security_audits" },
      { table_name: "users" },
    ])
  })

  it("keeps the identity tuple unique and prevents reassignment", async () => {
    const firstUserId = randomUUID()
    const secondUserId = randomUUID()
    const identityId = randomUUID()
    await createUser(prisma, { id: firstUserId })
    await createUser(prisma, { id: secondUserId })
    await createExternalIdentity(prisma, {
      id: identityId,
      userId: firstUserId,
      provider: "workforce",
      issuer: "https://id.example.test",
      subject: "person-123",
    })

    await expect(
      prisma.externalIdentity.create({
        data: {
          id: randomUUID(),
          userId: secondUserId,
          provider: "workforce",
          issuer: "https://id.example.test",
          subject: "person-123",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" })
    await expect(
      prisma.externalIdentity.update({
        where: { id: identityId },
        data: { userId: secondUserId },
      }),
    ).rejects.toThrow("External identity mappings are immutable")
  })

  it("installs the indexes that protect tuple and revision concurrency", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'external_identities_provider_issuer_subject_key',
          'authentication_provider_revisions_provider_id_revision_key',
          'authentication_providers_key_key'
        )
      ORDER BY indexname
    `

    expect(indexes).toEqual([
      { indexname: "authentication_provider_revisions_provider_id_revision_key" },
      { indexname: "authentication_providers_key_key" },
      { indexname: "external_identities_provider_issuer_subject_key" },
    ])
  })

  it("keeps provider revisions and security audits immutable", async () => {
    const providerId = randomUUID()
    const revisionId = randomUUID()
    const auditId = randomUUID()
    await prisma.authenticationProvider.create({
      data: { id: providerId, key: "workforce" },
    })
    await prisma.authenticationProviderRevision.create({
      data: {
        id: revisionId,
        providerId,
        revision: 1,
        configurationDigest: "a".repeat(64),
        settings: { issuer: "https://id.example.test" },
      },
    })
    await prisma.authenticationProvider.update({
      where: { id: providerId },
      data: { selectedRevisionId: revisionId },
    })
    await prisma.securityAudit.create({
      data: {
        id: auditId,
        action: "identity.provider_revision.selected",
        outcome: "SUCCESS",
        targetType: "authentication_provider",
        targetId: providerId,
        context: { revision: 1 },
      },
    })

    await expect(
      prisma.authenticationProviderRevision.update({
        where: { id: revisionId },
        data: { settings: { issuer: "https://changed.example.test" } },
      }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(prisma.securityAudit.delete({ where: { id: auditId } })).rejects.toThrow(
      "Security audit records are immutable",
    )
  })
})
