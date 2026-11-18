import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { revokeGitHubRepositoryAccess } from "../revoke-github-repository-access"

const githubProvider = { configurationDigest: "a".repeat(64), revision: 1 }
const membershipCount = Number(process.env.GITHUB_ACCESS_MEMBERSHIPS ?? 1_000)

async function createInstallation() {
  const provider = await prisma.authenticationProvider.create({
    data: { enabled: false, key: "github" },
  })
  const revision = await prisma.authenticationProviderRevision.create({
    data: {
      configurationDigest: githubProvider.configurationDigest,
      providerId: provider.id,
      revision: 1,
    },
  })
  await prisma.authenticationProvider.update({
    data: { enabled: true, selectedRevisionId: revision.id },
    where: { id: provider.id },
  })
  const repository = await prisma.repository.create({
    data: { defaultBranch: "main", githubRepositoryId: 1001n, nameWithOwner: "team/app" },
  })
  for (let index = 0; index < membershipCount; index += 1) {
    const user = await prisma.user.create({ data: {} })
    const identity = await prisma.externalIdentity.create({
      data: {
        issuer: "https://github.com",
        provider: "github",
        subject: String(index + 1),
        userId: user.id,
      },
    })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerAssignmentSubject: "github_repository_access",
        providerRevisionId: revision.id,
        role: "MEMBER",
        source: "AUTHENTICATION_PROVIDER",
      },
    })
    await prisma.repositoryAccessGrant.create({
      data: { membershipId: membership.id, observedAt: new Date(0), repositoryId: repository.id },
    })
    await prisma.hubSession.create({
      data: {
        digest: randomBytes(32).toString("hex"),
        expiresAt: new Date("2099-01-01T00:00:00Z"),
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerRevisionId: revision.id,
        revocationRevision: 0,
      },
    })
  }
}

describe("githubAccessTransactionOptions", () => {
  it("revokes a large installation in one transaction", { timeout: 120_000 }, async () => {
    await createInstallation()

    await revokeGitHubRepositoryAccess(
      prisma,
      { disconnect: true, githubRepositoryIds: "all" },
      githubProvider,
    )

    await expect(prisma.repositoryAccessGrant.count()).resolves.toBe(0)
    await expect(prisma.hubSession.count({ where: { endedAt: null } })).resolves.toBe(0)
  })
})
