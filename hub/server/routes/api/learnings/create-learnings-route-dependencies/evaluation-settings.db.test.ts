import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { changeScreenshotConsent } from "../../../../domains/learning/change-screenshot-consent"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/change-screenshot-consent", () => ({
  changeScreenshotConsent: vi.fn(),
}))
vi.mock("../../../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock("../../../../integrations/bullmq/enqueue-job", () => ({ enqueueJob: vi.fn() }))

describe("evaluation settings", () => {
  it("allows screenshots only while evaluations are on and removes them when evaluations stop", async () => {
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
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    await prisma.repositoryAccessGrant.create({
      data: {
        accessLevel: "ADMIN",
        membershipId: membership.id,
        observedAt: new Date(),
        repositoryId: repository.id,
      },
    })
    vi.mocked(changeScreenshotConsent).mockResolvedValueOnce("grant_1")
    vi.mocked(changeScreenshotConsent).mockResolvedValueOnce(null)
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    const change = {
      actor: "human:mona",
      actorMembershipId: membership.id,
      repositoryId: repository.id,
      sessionDigest,
    }

    await expect(
      learnings.changeEvaluationSettings({ ...change, screenshots: true }),
    ).rejects.toMatchObject({ code: "evaluations_disabled", status: 409 })
    await learnings.changeEvaluationSettings({ ...change, enabled: true, screenshots: true })
    expect(await learnings.getEvaluationSettings(repository.id)).toMatchObject({
      enabled: true,
      screenshots: { allowed: true },
    })
    await learnings.changeEvaluationSettings({ ...change, enabled: false })

    expect(await learnings.getEvaluationSettings(repository.id)).toMatchObject({
      enabled: false,
      screenshots: { allowed: false },
    })
    expect(vi.mocked(changeScreenshotConsent).mock.lastCall?.[0]).toMatchObject({
      allowed: false,
      grantId: "grant_1",
    })
    expect(vi.mocked(enqueueJob).mock.lastCall?.[2]).toEqual({
      repositoryId: repository.id,
      grantId: "grant_1",
    })
  })

  it("lets only a Hub administrator change the shared budget", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const identity = await prisma.externalIdentity.create({
      data: { issuer: "https://github.com", provider: "github", subject: "17", userId: user.id },
    })
    const repository = await prisma.repository.create({
      data: { defaultBranch: "main", githubRepositoryId: 17n, nameWithOwner: "octo/source" },
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    const budget = { actorMembershipId: membership.id, monthlyBudgetCredits: "12.5" }

    await expect(learnings.changeEvaluationBudget(budget)).rejects.toMatchObject({
      code: "hub_administrator_required",
      status: 403,
    })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
      },
    })
    await learnings.changeEvaluationBudget(budget)

    expect(await learnings.getEvaluationSettings(repository.id)).toMatchObject({
      monthlyBudgetCredits: "12.5",
    })
  })
})
