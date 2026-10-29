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

  it("keeps the identity tuple unique and rejects every identity history change", async () => {
    const firstUserId = randomUUID()
    const secondUserId = randomUUID()
    const identityId = randomUUID()
    const auditId = randomUUID()
    await createUser(prisma, { id: firstUserId })
    await createUser(prisma, { id: secondUserId })
    await createExternalIdentity(prisma, {
      id: identityId,
      userId: firstUserId,
      provider: "workforce",
      issuer: "https://id.example.test",
      subject: "person-123",
    })
    await prisma.securityAudit.create({
      data: {
        id: auditId,
        action: "identity.external.created",
        outcome: "SUCCESS",
        targetType: "external_identity",
        targetId: identityId,
        context: { provider: "workforce" },
      },
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
    ).rejects.toThrow("External identity records are immutable")
    await expect(
      prisma.externalIdentity.update({
        where: { id: identityId },
        data: { id: randomUUID() },
      }),
    ).rejects.toThrow("External identity records are immutable")
    await expect(
      prisma.externalIdentity.update({
        where: { id: identityId },
        data: { createdAt: new Date("2000-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow("External identity records are immutable")
    await expect(
      prisma.externalIdentity.update({
        where: { id: identityId },
        data: { updatedAt: new Date("2000-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow("External identity records are immutable")
    await expect(prisma.externalIdentity.delete({ where: { id: identityId } })).rejects.toThrow(
      "External identity records are immutable",
    )
    await expect(
      prisma.externalIdentity.findUnique({ where: { id: identityId } }),
    ).resolves.toEqual(expect.objectContaining({ id: identityId, userId: firstUserId }))
    await expect(prisma.securityAudit.findUnique({ where: { id: auditId } })).resolves.toEqual(
      expect.objectContaining({ targetId: identityId }),
    )
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

  it("keeps provider revisions and security audit history immutable", async () => {
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
    await expect(
      prisma.authenticationProviderRevision.update({
        where: { id: revisionId },
        data: { id: randomUUID() },
      }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(
      prisma.authenticationProviderRevision.update({
        where: { id: revisionId },
        data: { createdAt: new Date("2000-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(
      prisma.authenticationProviderRevision.update({
        where: { id: revisionId },
        data: { updatedAt: new Date("2000-01-01T00:00:00Z") },
      }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(
      prisma.authenticationProviderRevision.delete({ where: { id: revisionId } }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(
      prisma.securityAudit.update({
        where: { id: auditId },
        data: {
          id: randomUUID(),
          createdAt: new Date("2000-01-01T00:00:00Z"),
          updatedAt: new Date("2000-01-01T00:00:00Z"),
        },
      }),
    ).rejects.toThrow("Security audit records are immutable")
    await expect(prisma.securityAudit.delete({ where: { id: auditId } })).rejects.toThrow(
      "Security audit records are immutable",
    )
    const provider = await prisma.authenticationProvider.findUnique({
      where: { id: providerId },
      include: { selectedRevision: true },
    })
    expect(provider?.selectedRevisionId).toBe(revisionId)
    expect(provider?.selectedRevision?.id).toBe(revisionId)
  })

  it("rejects foreign-key violations and selecting another provider's revision", async () => {
    const firstProviderId = randomUUID()
    const secondProviderId = randomUUID()
    const secondRevisionId = randomUUID()
    await prisma.authenticationProvider.createMany({
      data: [
        { id: firstProviderId, key: "first" },
        { id: secondProviderId, key: "second" },
      ],
    })
    await prisma.authenticationProviderRevision.create({
      data: {
        id: secondRevisionId,
        providerId: secondProviderId,
        revision: 1,
        configurationDigest: "b".repeat(64),
        settings: { issuer: "https://id.example.test" },
      },
    })

    await expect(
      prisma.externalIdentity.create({
        data: {
          id: randomUUID(),
          userId: randomUUID(),
          provider: "workforce",
          issuer: "https://id.example.test",
          subject: "missing-user",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" })
    await expect(
      prisma.authenticationProviderRevision.create({
        data: {
          id: randomUUID(),
          providerId: randomUUID(),
          revision: 1,
          configurationDigest: "c".repeat(64),
          settings: {},
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" })
    await expect(
      prisma.authenticationProvider.update({
        where: { id: firstProviderId },
        data: { selectedRevisionId: secondRevisionId },
      }),
    ).rejects.toThrow("Selected revision must belong to its authentication provider")
  })

  it("rejects audit context that exceeds the migration byte bound", async () => {
    await expect(
      prisma.securityAudit.create({
        data: {
          id: randomUUID(),
          action: "identity.external.create_failed",
          outcome: "FAILURE",
          targetType: "external_identity",
          context: { detail: "x".repeat(5_000) },
        },
      }),
    ).rejects.toThrow()
    await expect(prisma.securityAudit.count()).resolves.toBe(0)
  })
})
