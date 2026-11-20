import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import pg from "pg"

import { RepositoryAccessLevel } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { localDeveloperIdentity } from "../../../utils/local-developer-identity"
import { getDatabaseUrl } from "../../../../test/database/get-database-url"
import { waitForBlockedQuery } from "../../../../test/database/wait-for-blocked-query"
import { lockRepositoryAdministratorAuthority } from "."

async function createAuthority(accessLevel: RepositoryAccessLevel) {
  const provider = await prisma.authenticationProvider.create({
    data: { key: "github", enabled: false },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "a".repeat(64),
      providerId: provider.id,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  const user = await prisma.user.create({ data: {} })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  const repository = await prisma.repository.create({
    data: {
      defaultBranch: "main",
      githubRepositoryId: 17n,
      nameWithOwner: "octo/example",
    },
  })
  const grant = await prisma.repositoryAccessGrant.create({
    data: {
      accessLevel,
      membershipId: membership.id,
      observedAt: new Date(),
      repositoryId: repository.id,
    },
  })
  return { grant, membership, provider, repository }
}

async function createLocalAuthority(
  identity: { issuer: string; provider: string; subject: string } = localDeveloperIdentity,
) {
  const provider = await prisma.authenticationProvider.create({
    data: { key: "local", enabled: false },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: "b".repeat(64),
      providerId: provider.id,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  const user = await prisma.user.create({ data: {} })
  await prisma.externalIdentity.create({ data: { ...identity, userId: user.id } })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  const repository = await prisma.repository.create({
    data: {
      defaultBranch: "main",
      localPath: `/local/prototypes/${randomUUID()}`,
      nameWithOwner: `local/${randomUUID()}`,
    },
  })
  await prisma.repositoryAccessGrant.create({
    data: {
      accessLevel: RepositoryAccessLevel.ADMIN,
      membershipId: membership.id,
      observedAt: new Date(),
      repositoryId: repository.id,
    },
  })
  return { membership, provider, repository }
}

async function authorize(membershipId: string, repositoryId: string) {
  return prisma.$transaction((transaction) =>
    lockRepositoryAdministratorAuthority(transaction, { membershipId, repositoryId }),
  )
}

describe("lockRepositoryAdministratorAuthority()", () => {
  it("authorizes an active member with current ADMIN evidence for a connected repository", async () => {
    const { membership, repository } = await createAuthority(RepositoryAccessLevel.ADMIN)

    await expect(authorize(membership.id, repository.id)).resolves.toBe(true)
  })

  it("authorizes the fixed local developer's active ADMIN grant for a local repository", async () => {
    const { membership, repository } = await createLocalAuthority()

    await expect(authorize(membership.id, repository.id)).resolves.toBe(true)
  })

  it("does not substitute an ordinary identity for fixed local authority", async () => {
    const { membership, repository } = await createLocalAuthority({
      issuer: "https://github.com",
      provider: "github",
      subject: randomUUID(),
    })

    await expect(authorize(membership.id, repository.id)).resolves.toBe(false)
  })

  it.each([
    [
      "disabled local provider",
      async ({ provider }: Awaited<ReturnType<typeof createLocalAuthority>>) => {
        await prisma.authenticationProvider.update({
          data: { enabled: false, selectedRevisionId: null },
          where: { id: provider.id },
        })
      },
    ],
    [
      "GitHub-linked repository",
      async ({ repository }: Awaited<ReturnType<typeof createLocalAuthority>>) => {
        await prisma.repository.update({
          data: { githubRepositoryId: 17n },
          where: { id: repository.id },
        })
      },
    ],
    [
      "repository without a local path",
      async ({ repository }: Awaited<ReturnType<typeof createLocalAuthority>>) => {
        await prisma.repository.update({
          data: { localPath: null },
          where: { id: repository.id },
        })
      },
    ],
  ] as const)("denies local authority for a %s", async (_label, removeAuthority) => {
    const records = await createLocalAuthority()
    await removeAuthority(records)

    await expect(authorize(records.membership.id, records.repository.id)).resolves.toBe(false)
  })

  it("locks repository before grant while overlapping admission changes", async () => {
    const { grant, membership, repository } = await createAuthority(RepositoryAccessLevel.ADMIN)
    const repositoryHolder = new pg.Client({ connectionString: getDatabaseUrl() })
    const contender = new pg.Client({ connectionString: getDatabaseUrl() })
    const inspector = new pg.Client({ connectionString: getDatabaseUrl() })
    await Promise.all([repositoryHolder.connect(), contender.connect(), inspector.connect()])
    let holderOpen = false
    let contenderOpen = false
    let authorization: ReturnType<typeof authorize> | null = null
    try {
      await repositoryHolder.query("BEGIN")
      holderOpen = true
      await repositoryHolder.query("SELECT id FROM repositories WHERE id = $1 FOR UPDATE", [
        repository.id,
      ])
      const { pid } = (
        await repositoryHolder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!
      authorization = authorize(membership.id, repository.id)
      void authorization.catch(() => {})
      await waitForBlockedQuery(inspector, pid, 'FROM "repositories"')

      await contender.query("BEGIN")
      contenderOpen = true
      await contender.query(
        "SELECT id FROM repository_access_grants WHERE id = $1 FOR UPDATE NOWAIT",
        [grant.id],
      )
      await contender.query("ROLLBACK")
      contenderOpen = false

      await repositoryHolder.query("COMMIT")
      holderOpen = false
      await expect(authorization).resolves.toBe(true)
    } finally {
      if (contenderOpen) await contender.query("ROLLBACK")
      if (holderOpen) await repositoryHolder.query("ROLLBACK")
      if (authorization) await Promise.allSettled([authorization])
      await Promise.all([repositoryHolder.end(), contender.end(), inspector.end()])
    }
  })

  it.each([
    RepositoryAccessLevel.READ,
    RepositoryAccessLevel.TRIAGE,
    RepositoryAccessLevel.WRITE,
    RepositoryAccessLevel.MAINTAIN,
  ])("does not treat %s evidence as repository administration", async (accessLevel) => {
    const { membership, repository } = await createAuthority(accessLevel)

    await expect(authorize(membership.id, repository.id)).resolves.toBe(false)
  })

  it("does not substitute Hub administrator assignment for repository authority", async () => {
    const { membership, repository } = await createAuthority(RepositoryAccessLevel.READ)
    const identity = await prisma.externalIdentity.create({
      data: {
        issuer: "https://github.com",
        provider: "github",
        subject: "18",
        userId: membership.userId,
      },
    })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })

    await expect(authorize(membership.id, repository.id)).resolves.toBe(false)
  })

  it.each([
    [
      "inactive membership",
      async ({ membership }: Awaited<ReturnType<typeof createAuthority>>) => {
        await prisma.membership.update({
          data: { lifecycle: "SUSPENDED" },
          where: { id: membership.id },
        })
      },
    ],
    [
      "removed repository",
      async ({ repository }: Awaited<ReturnType<typeof createAuthority>>) => {
        await prisma.repository.update({
          data: { removedAt: new Date() },
          where: { id: repository.id },
        })
      },
    ],
    [
      "repository without a GitHub connection",
      async ({ repository }: Awaited<ReturnType<typeof createAuthority>>) => {
        await prisma.repository.update({
          data: { githubRepositoryId: null },
          where: { id: repository.id },
        })
      },
    ],
    [
      "disabled GitHub provider",
      async ({ provider }: Awaited<ReturnType<typeof createAuthority>>) => {
        await prisma.authenticationProvider.update({
          data: { enabled: false, selectedRevisionId: null },
          where: { id: provider.id },
        })
      },
    ],
    [
      "removed grant",
      async ({ grant }: Awaited<ReturnType<typeof createAuthority>>) => {
        await prisma.repositoryAccessGrant.delete({ where: { id: grant.id } })
      },
    ],
  ] as const)("denies authority after %s", async (_label, removeAuthority) => {
    const records = await createAuthority(RepositoryAccessLevel.ADMIN)
    await removeAuthority(records)

    await expect(authorize(records.membership.id, records.repository.id)).resolves.toBe(false)
  })
})
