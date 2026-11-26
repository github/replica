import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { changeEvaluationConsent } from "../../../../domains/learning/change-evaluation-consent"
import { enqueueJob } from "../../../../integrations/bullmq/enqueue-job"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/change-evaluation-consent", () => ({
  changeEvaluationConsent: vi.fn(),
}))
vi.mock("../../../../integrations/bullmq/create-job-queue", () => ({
  createJobQueue: vi.fn(() => ({ close: vi.fn() })),
}))
vi.mock("../../../../integrations/bullmq/enqueue-job", () => ({ enqueueJob: vi.fn() }))

describe("evaluation settings", () => {
  it("grants evaluation consent while evaluations are on and withdraws it, with screenshots, when they stop", async () => {
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
    // Records what Hub showed at the moment each store grant was withdrawn.
    let grantAtWithdrawal: string | null | undefined
    let evaluationAtWithdrawal: unknown
    vi.mocked(changeEvaluationConsent).mockImplementation(async ({ allowed, source }) => {
      if (allowed) return source === "agent_screenshots" ? "grant_1" : "evaluation_1"
      const setting = await prisma.repositoryEvaluationSetting.findUnique({
        where: { repositoryId: repository.id },
      })
      if (source === "agent_screenshots") grantAtWithdrawal = setting?.screenshotGrantId
      else {
        evaluationAtWithdrawal = {
          enabled: setting?.enabled,
          evaluationGrantId: setting?.evaluationGrantId,
        }
      }
      return null
    })
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
    expect(vi.mocked(changeEvaluationConsent).mock.lastCall?.[0]).toMatchObject({
      allowed: false,
      grantId: "grant_1",
    })
    expect(grantAtWithdrawal).toBeNull()
    expect(vi.mocked(changeEvaluationConsent)).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        grantId: "evaluation_1",
        source: "hub_review_comments",
      }),
    )
    expect(evaluationAtWithdrawal).toEqual({ enabled: false, evaluationGrantId: "evaluation_1" })
    await expect(
      prisma.repositoryEvaluationSetting.findUnique({ where: { repositoryId: repository.id } }),
    ).resolves.toMatchObject({ evaluationGrantId: null })
    expect(vi.mocked(enqueueJob).mock.lastCall?.[2]).toEqual({
      repositoryId: repository.id,
      grantId: "grant_1",
    })
  })

  it("lets only a signed-in Hub administrator change the shared budget", async () => {
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
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: "https://hub.example.test", DATABASE_URL: getDatabaseUrl() },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    const budget = { actorMembershipId: membership.id, sessionDigest, monthlyBudgetCredits: "12.5" }

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
