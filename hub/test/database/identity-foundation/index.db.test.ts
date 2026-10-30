import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../server/integrations/prisma"
import { createExternalIdentity } from "../../../server/repositories/external-identities/create-external-identity"
import { createUser } from "../../../server/repositories/users/create-user"

async function createProviderAggregate(key: string, digest = "a".repeat(64)) {
  const providerId = randomUUID()
  const revisionId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({
      data: { id: providerId, key },
    })
    await transaction.authenticationProviderRevision.create({
      data: {
        id: revisionId,
        providerId,
        revision: 1,
        configurationDigest: digest,
      },
    })
    await transaction.authenticationProvider.update({
      where: { id: providerId },
      data: { selectedRevisionId: revisionId },
    })
  })
  return { providerId, revisionId }
}

describe("identity foundation migration", () => {
  it("deploys C1 followed by the C2 authentication proof migration", async () => {
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

    expect(migrations).toEqual([
      { migration_name: "20261029203000_identity_foundation" },
      { migration_name: "20261030170000_authentication_proof" },
    ])
    expect(tables).toEqual([
      { table_name: "admission_handoffs" },
      { table_name: "authentication_provider_revisions" },
      { table_name: "authentication_providers" },
      { table_name: "authentication_revocation_generations" },
      { table_name: "authorization_attempts" },
      { table_name: "external_identities" },
      { table_name: "security_audits" },
      { table_name: "users" },
    ])
    const revisionColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'authentication_provider_revisions'
      ORDER BY ordinal_position
    `
    expect(revisionColumns.map(({ column_name }) => column_name)).toEqual([
      "id",
      "provider_id",
      "revision",
      "configuration_digest",
      "created_at",
      "updated_at",
    ])
  })

  it("enforces one-use authentication history and monotonic global revocation", async () => {
    const generation = await prisma.authenticationRevocationGeneration.findUniqueOrThrow({
      where: { key: "global" },
    })
    await expect(
      prisma.authenticationRevocationGeneration.update({
        where: { key: "global" },
        data: { generation: generation.generation },
      }),
    ).rejects.toThrow("Authentication revocation generation may only increase")
    await expect(
      prisma.authenticationRevocationGeneration.delete({ where: { key: "global" } }),
    ).rejects.toThrow("Authentication revocation generation may only increase")
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

  it("enforces the combined UTF-8 tuple index byte limit", async () => {
    const userId = randomUUID()
    const provider = "p"
    const issuer = "界".repeat(500)
    const subjectAtLimit = `${"界".repeat(165)}aa`
    await createUser(prisma, { id: userId })

    await expect(
      prisma.externalIdentity.create({
        data: {
          id: randomUUID(),
          userId,
          provider,
          issuer,
          subject: subjectAtLimit,
        },
      }),
    ).resolves.toMatchObject({ provider, issuer, subject: subjectAtLimit })
    await expect(
      prisma.externalIdentity.create({
        data: {
          id: randomUUID(),
          userId,
          provider,
          issuer,
          subject: `${subjectAtLimit}a`,
        },
      }),
    ).rejects.toThrow()
    await expect(prisma.externalIdentity.count()).resolves.toBe(1)
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
    const { providerId, revisionId } = await createProviderAggregate("workforce")
    const auditId = randomUUID()
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
        data: { configurationDigest: "b".repeat(64) },
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

  it("requires every committed provider to select its own existing revision", async () => {
    const first = await createProviderAggregate("first")
    const second = await createProviderAggregate("second", "b".repeat(64))
    const unselectedSecondRevisionId = randomUUID()
    await prisma.authenticationProviderRevision.create({
      data: {
        id: unselectedSecondRevisionId,
        providerId: second.providerId,
        revision: 2,
        configurationDigest: "c".repeat(64),
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
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" })
    await expect(
      prisma.authenticationProvider.update({
        where: { id: first.providerId },
        data: { selectedRevisionId: unselectedSecondRevisionId },
      }),
    ).rejects.toThrow("Selected revision must belong to its authentication provider")
    await expect(
      prisma.authenticationProvider.update({
        where: { id: first.providerId },
        data: { selectedRevisionId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2003" })
    await expect(
      prisma.authenticationProviderRevision.delete({
        where: { id: first.revisionId },
      }),
    ).rejects.toThrow("Authentication provider revisions are immutable")
    await expect(
      prisma.authenticationProvider.create({
        data: { id: randomUUID(), key: "unselected" },
      }),
    ).rejects.toThrow("Authentication provider must have a selected revision")
  })

  it("allows atomic provider creation and selection of the next owned revision", async () => {
    const first = await createProviderAggregate("workforce")
    const nextRevisionId = randomUUID()

    await prisma.$transaction(async (transaction) => {
      await transaction.authenticationProviderRevision.create({
        data: {
          id: nextRevisionId,
          providerId: first.providerId,
          revision: 2,
          configurationDigest: "b".repeat(64),
        },
      })
      await transaction.authenticationProvider.update({
        where: { id: first.providerId },
        data: { selectedRevisionId: nextRevisionId },
      })
    })

    await expect(
      prisma.authenticationProvider.findUnique({
        where: { id: first.providerId },
        include: { selectedRevision: true },
      }),
    ).resolves.toMatchObject({
      selectedRevision: { id: nextRevisionId, revision: 2 },
    })
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

  it("allows informational immutable audits without an outcome", async () => {
    const auditId = randomUUID()

    await expect(
      prisma.securityAudit.create({
        data: {
          id: auditId,
          action: "identity.kernel.observed",
          targetType: "identity_kernel",
          context: { detail: "informational" },
        },
      }),
    ).resolves.toMatchObject({ id: auditId, outcome: null })
    await expect(
      prisma.securityAudit.update({
        where: { id: auditId },
        data: { outcome: "SUCCESS" },
      }),
    ).rejects.toThrow("Security audit records are immutable")
  })
})
