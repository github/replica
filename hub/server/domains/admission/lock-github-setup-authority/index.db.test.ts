import { randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { AdmissionAuthorityChangedError } from "../errors"
import { syncGitHubInstallationRepositories } from "../sync-github-installation-repositories"
import { lockGitHubSetupAuthority } from "."

const githubProvider = { configurationDigest: "a".repeat(64), revision: 1 }
const evidence = { defaultBranch: "main", githubRepositoryId: 1001, nameWithOwner: "team/app" }

async function createAdministrator() {
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
  const user = await prisma.user.create({ data: {} })
  const identity = await prisma.externalIdentity.create({
    data: { issuer: "https://github.com", provider: "github", subject: "101", userId: user.id },
  })
  const membership = await prisma.membership.create({ data: { userId: user.id } })
  await prisma.membershipAssignment.create({
    data: {
      externalIdentityId: identity.id,
      membershipId: membership.id,
      role: "ADMINISTRATOR",
      source: "HUB_ADMINISTRATOR",
    },
  })
  const session = await prisma.hubSession.create({
    data: {
      digest: randomBytes(32).toString("hex"),
      expiresAt: new Date("2099-01-01T00:00:00Z"),
      externalIdentityId: identity.id,
      membershipId: membership.id,
      providerRevisionId: revision.id,
      revocationRevision: 0,
    },
  })
  return { membershipId: membership.id, session }
}

function sync(
  caller: { membershipId: string | null; sessionDigest?: string },
  before = async () => {},
) {
  return syncGitHubInstallationRepositories(
    prisma,
    async () => {
      await before()
      return [evidence]
    },
    githubProvider,
    { authorize: (transaction) => lockGitHubSetupAuthority(transaction, caller) },
  )
}

describe("lockGitHubSetupAuthority()", () => {
  it("lets a current administrator session save the repository snapshot", async () => {
    const { membershipId, session } = await createAdministrator()

    await expect(sync({ membershipId, sessionDigest: session.digest })).resolves.toEqual([evidence])
    await expect(prisma.repository.count()).resolves.toBe(1)
  })

  it("saves nothing when the administrator session ends while GitHub is listed", async () => {
    const { membershipId, session } = await createAdministrator()

    await expect(
      sync({ membershipId, sessionDigest: session.digest }, async () => {
        await prisma.hubSession.update({ data: { endedAt: new Date() }, where: { id: session.id } })
      }),
    ).rejects.toBeInstanceOf(AdmissionAuthorityChangedError)
    await expect(prisma.repository.count()).resolves.toBe(0)
  })

  it("rejects bootstrap setup once an administrator exists", async () => {
    await createAdministrator()

    await expect(sync({ membershipId: null })).rejects.toBeInstanceOf(
      AdmissionAuthorityChangedError,
    )
    await expect(prisma.repository.count()).resolves.toBe(0)
  })
})
