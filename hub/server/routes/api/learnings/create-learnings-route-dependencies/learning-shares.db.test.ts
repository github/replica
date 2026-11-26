import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { getLearningOverview } from "../../../../domains/learning/get-learning-overview"
import { readShareableLearnings } from "../../../../domains/learning/read-shareable-learnings"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/get-learning-overview", () => ({
  getLearningOverview: vi.fn(),
}))
vi.mock("../../../../domains/learning/read-shareable-learnings", () => ({
  readShareableLearnings: vi.fn(),
}))

describe("learning shares", () => {
  it("gives other repositories a shared learning until it is withdrawn", async () => {
    const provider = await prisma.authenticationProvider.create({
      data: { key: "github", enabled: false },
    })
    const revision = await prisma.authenticationProviderRevision.create({
      data: { configurationDigest: "a".repeat(64), providerId: provider.id, revision: 1 },
    })
    await prisma.authenticationProvider.update({
      data: { enabled: true, selectedRevisionId: revision.id },
      where: { id: provider.id },
    })
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const identity = await prisma.externalIdentity.create({
      data: { issuer: "https://github.com", provider: "github", subject: "17", userId: user.id },
    })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
    const revocation = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const sessionDigest = "b".repeat(64)
    await prisma.hubSession.create({
      data: {
        digest: sessionDigest,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerRevisionId: revision.id,
        revocationRevision: revocation.revision,
      },
    })
    const source = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    const receiver = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 18n, nameWithOwner: "octo/receiver" },
    })
    await prisma.repositoryAccessGrant.create({
      data: {
        accessLevel: "ADMIN",
        membershipId: membership.id,
        observedAt: new Date(),
        repositoryId: source.id,
      },
    })
    const record = { id: "mem_shared", content: "Use one primary button per page." }
    vi.mocked(readShareableLearnings).mockResolvedValue([record])
    vi.mocked(getLearningOverview).mockResolvedValue({
      loadError: null,
      identityReviewCount: 0,
      suggestions: [],
      learnings: [],
      rejected: [],
      shared: [],
      recall: { text: "", count: 0 },
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    const share = {
      actorMembershipId: membership.id,
      learningId: "mem_shared",
      repositoryId: source.id,
      sessionDigest,
    }

    expect(await learnings.share({ ...share, shared: true })).toEqual({
      notice: "Shared across Hub.",
    })
    await learnings.getOverview({ repositoryId: receiver.id, viewer: "human:mona" })
    expect(vi.mocked(getLearningOverview).mock.lastCall?.[0]).toMatchObject({
      shared: [{ record, source: "octo/source", sharedBy: null }],
      sharedLearningIds: [],
    })
    await learnings.getOverview({ repositoryId: source.id, viewer: "human:mona" })
    expect(vi.mocked(getLearningOverview).mock.lastCall?.[0]).toMatchObject({
      shared: [],
      sharedLearningIds: ["mem_shared"],
    })
    vi.mocked(readShareableLearnings).mockRejectedValueOnce(new Error("Unexpected store shape."))
    await learnings.getOverview({ repositoryId: receiver.id, viewer: "human:mona" })
    expect(vi.mocked(getLearningOverview).mock.lastCall?.[0]).toMatchObject({ shared: [] })

    await learnings.share({ ...share, shared: false })
    await learnings.getOverview({ repositoryId: receiver.id, viewer: "human:mona" })
    expect(vi.mocked(getLearningOverview).mock.lastCall?.[0]).toMatchObject({ shared: [] })
    expect(
      await prisma.learningShare.findUniqueOrThrow({
        where: { repositoryId_learningId: { repositoryId: source.id, learningId: "mem_shared" } },
      }),
    ).toMatchObject({ sharedByMembershipId: membership.id, withdrawnByMembershipId: membership.id })
    const audits = await prisma.securityAudit.findMany({
      where: { targetType: "learning", targetId: "mem_shared" },
      orderBy: { createdAt: "asc" },
    })
    expect(audits.map((audit) => audit.action)).toEqual(["learning.share", "learning.unshare"])
  })

  it("saves no share for a learning agents do not get or an administrator who lost access", async () => {
    const provider = await prisma.authenticationProvider.create({
      data: { key: "github", enabled: false },
    })
    const revision = await prisma.authenticationProviderRevision.create({
      data: { configurationDigest: "a".repeat(64), providerId: provider.id, revision: 1 },
    })
    await prisma.authenticationProvider.update({
      data: { enabled: true, selectedRevisionId: revision.id },
      where: { id: provider.id },
    })
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const identity = await prisma.externalIdentity.create({
      data: { issuer: "https://github.com", provider: "github", subject: "17", userId: user.id },
    })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
    const revocation = await prisma.sessionRevocationState.findUniqueOrThrow({
      where: { key: "global" },
    })
    const sessionDigest = "b".repeat(64)
    await prisma.hubSession.create({
      data: {
        digest: sessionDigest,
        expiresAt: new Date(Date.now() + 60_000),
        externalIdentityId: identity.id,
        membershipId: membership.id,
        providerRevisionId: revision.id,
        revocationRevision: revocation.revision,
      },
    })
    const source = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    const grant = await prisma.repositoryAccessGrant.create({
      data: {
        accessLevel: "ADMIN",
        membershipId: membership.id,
        observedAt: new Date(),
        repositoryId: source.id,
      },
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    const share = {
      actorMembershipId: membership.id,
      learningId: "mem_shared",
      repositoryId: source.id,
      sessionDigest,
      shared: true,
    }

    vi.mocked(readShareableLearnings).mockResolvedValueOnce([])
    await expect(learnings.share(share)).rejects.toMatchObject({
      code: "learning_not_shareable",
      status: 409,
    })
    vi.mocked(readShareableLearnings).mockResolvedValueOnce([{ id: "mem_shared" }])
    await prisma.repositoryAccessGrant.update({
      data: { accessLevel: "READ" },
      where: { id: grant.id },
    })
    await expect(learnings.share(share)).rejects.toMatchObject({
      code: "repository_administrator_required",
      status: 403,
    })

    expect(await prisma.learningShare.count()).toBe(0)
    const audits = await prisma.securityAudit.findMany({ where: { targetId: source.id } })
    expect(audits.map((audit) => audit.action)).toEqual([
      "repository.administration.learning_share.denied",
    ])
  })
})
