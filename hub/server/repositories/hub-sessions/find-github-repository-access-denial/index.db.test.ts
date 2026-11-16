import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findGitHubRepositoryAccessDenial } from "."

async function createSession(
  options: {
    endReason?: "GITHUB_REPOSITORY_ACCESS_REVOKED" | null
    ended?: boolean
    expired?: boolean
    identityProvider?: string | null
    lifecycle?: "ACTIVE" | "SUSPENDED" | "REMOVED"
    profileProvider?: string | null
  } = {},
) {
  const {
    endReason = "GITHUB_REPOSITORY_ACCESS_REVOKED",
    ended = true,
    expired = false,
    identityProvider = "github",
    lifecycle = "ACTIVE",
    profileProvider = "github",
  } = options
  const userId = randomUUID()
  const membershipId = randomUUID()
  const externalIdentityId = identityProvider ? randomUUID() : null
  const digest = "a".repeat(64)
  await prisma.user.create({ data: { id: userId } })
  if (externalIdentityId && identityProvider) {
    await prisma.externalIdentity.create({
      data: {
        id: externalIdentityId,
        userId,
        provider: identityProvider,
        issuer: `https://${identityProvider}.example.test`,
        subject: "person-1",
      },
    })
  }
  await prisma.membership.create({ data: { id: membershipId, userId, lifecycle } })
  if (profileProvider) {
    await prisma.userProfile.create({
      data: { userId, provider: profileProvider, login: "octocat" },
    })
  }
  await prisma.hubSession.create({
    data: {
      membershipId,
      externalIdentityId,
      digest,
      revocationRevision: 0,
      createdAt: new Date(Date.now() - 3_600_000),
      expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)),
      endedAt: ended ? new Date(Date.now() - 30_000) : null,
      endReason,
    },
  })
  return { digest, externalIdentityId, membershipId, userId }
}

async function createProviderRevision(key: string) {
  const providerId = randomUUID()
  const revisionId = randomUUID()
  await prisma.$transaction(async (transaction) => {
    await transaction.authenticationProvider.create({ data: { id: providerId, key } })
    await transaction.authenticationProviderRevision.create({
      data: {
        id: revisionId,
        providerId,
        revision: 1,
        configurationDigest: "b".repeat(64),
      },
    })
    await transaction.authenticationProvider.update({
      where: { id: providerId },
      data: { selectedRevisionId: revisionId },
    })
  })
  return revisionId
}

describe("findGitHubRepositoryAccessDenial()", () => {
  it("finds a revoked GitHub member's session and its uniquely attributable login", async () => {
    const { digest, membershipId, externalIdentityId } = await createSession()
    const providerRevisionId = await createProviderRevision("github")
    await prisma.membershipAssignment.create({
      data: {
        membershipId,
        externalIdentityId: externalIdentityId!,
        providerRevisionId,
        providerAssignmentSubject: "github_repository_access",
        source: "AUTHENTICATION_PROVIDER",
        role: "MEMBER",
        lifecycle: "REVOKED",
      },
    })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toEqual({
      login: "octocat",
    })
  })

  it.each([
    ["expired", { expired: true }],
    ["signed out", { endReason: null }],
    ["still open", { endReason: null, ended: false }],
    ["an Entra session", { identityProvider: "entra" }],
    ["a session with no linked identity", { identityProvider: null }],
    ["a suspended membership", { lifecycle: "SUSPENDED" }],
    ["a removed membership", { lifecycle: "REMOVED" }],
  ] as const)("does not report %s as repository access loss", async (_label, options) => {
    const { digest } = await createSession(options)

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toBeNull()
  })

  it("does not report an unknown session as repository access loss", async () => {
    await expect(findGitHubRepositoryAccessDenial(prisma, "b".repeat(64))).resolves.toBeNull()
  })

  it("does not report access loss when a connected repository grant remains", async () => {
    const { digest, membershipId } = await createSession()
    const repository = await prisma.repository.create({
      data: { githubRepositoryId: 123, nameWithOwner: "octo/prototype", defaultBranch: "main" },
    })
    await prisma.repositoryAccessGrant.create({
      data: { membershipId, repositoryId: repository.id, observedAt: new Date() },
    })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toBeNull()
  })

  it("does not report access loss when independent administrator authority remains", async () => {
    const { digest, externalIdentityId, membershipId } = await createSession()
    await prisma.membershipAssignment.create({
      data: {
        membershipId,
        externalIdentityId: externalIdentityId!,
        source: "BOOTSTRAP",
        role: "ADMINISTRATOR",
      },
    })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toBeNull()
  })

  it("reports GitHub access loss even when independent Entra membership remains", async () => {
    const { digest, membershipId, userId } = await createSession()
    const externalIdentityId = randomUUID()
    await prisma.externalIdentity.create({
      data: {
        id: externalIdentityId,
        userId,
        provider: "entra",
        issuer: "https://login.example.test",
        subject: "entra-person",
      },
    })
    const revisionId = await createProviderRevision("entra")
    await prisma.membershipAssignment.create({
      data: {
        membershipId,
        externalIdentityId,
        providerRevisionId: revisionId,
        providerAssignmentSubject: "entra-group",
        source: "AUTHENTICATION_PROVIDER",
        role: "MEMBER",
      },
    })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toEqual({
      login: "octocat",
    })
  })

  it("does not identify a GitHub login when multiple GitHub identities are linked", async () => {
    const { digest, userId } = await createSession()
    await prisma.externalIdentity.create({
      data: {
        userId,
        provider: "github",
        issuer: "https://github.example.test",
        subject: "another-person",
      },
    })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toEqual({ login: null })
  })

  it.each([
    ["no profile", null],
    ["a profile from another provider", "entra"],
  ])("omits the login with %s", async (_label, profileProvider) => {
    const { digest } = await createSession({ profileProvider })

    await expect(findGitHubRepositoryAccessDenial(prisma, digest)).resolves.toEqual({ login: null })
  })
})
