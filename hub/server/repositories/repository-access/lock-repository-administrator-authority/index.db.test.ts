import { describe, expect, it } from "vitest"

import { RepositoryAccessLevel } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
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
