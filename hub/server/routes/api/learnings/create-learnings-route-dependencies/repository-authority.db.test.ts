import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { executeLearningDecision } from "../../../../domains/learning/execute-learning-decision"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/execute-learning-decision", () => ({
  executeLearningDecision: vi.fn(),
}))

describe("learning decision repository authority", () => {
  it("audits a lost authority denial without reaching the learning store or recording its reason", async () => {
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
    const identity = await prisma.externalIdentity.create({
      data: {
        issuer: "https://github.com",
        provider: "github",
        subject: "17",
        userId: user.id,
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
      data: {
        defaultBranch: "main",
        githubRepositoryId: 17n,
        nameWithOwner: "octo/example",
      },
    })
    const grant = await prisma.repositoryAccessGrant.create({
      data: {
        accessLevel: "ADMIN",
        membershipId: membership.id,
        observedAt: new Date(),
        repositoryId: repository.id,
      },
    })
    const learnings = await createLearningsRouteDependencies(
      {
        HUB_APPLICATION_ORIGIN: "https://hub.example.test",
        DATABASE_URL: getDatabaseUrl(),
      },
      { restore: vi.fn() },
      pino({ level: "silent" }),
    )
    await prisma.repositoryAccessGrant.update({
      data: { accessLevel: "READ" },
      where: { id: grant.id },
    })
    const privateReason = "A confidential explanation from the reviewer."

    await expect(
      learnings.decide({
        actor: "human:mona",
        actorMembershipId: membership.id,
        decision: { decision: "retire", reason: privateReason },
        learningId: "mem_private",
        repositoryId: repository.id,
        sessionDigest,
      }),
    ).rejects.toMatchObject({
      code: "repository_administrator_required",
      status: 403,
    })

    expect(vi.mocked(executeLearningDecision)).not.toHaveBeenCalled()
    expect(
      await prisma.learningDecisionOperation.count({
        where: { repositoryId: repository.id },
      }),
    ).toBe(0)
    const audits = await prisma.securityAudit.findMany({
      where: {
        action: "repository.administration.learning_decision.denied",
        targetId: repository.id,
      },
    })
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      outcome: "DENIED",
      targetType: "repository",
      context: {
        actorMembershipId: membership.id,
        operation: "learning_decision",
        reason: "authority_missing",
      },
    })
    expect(JSON.stringify(audits[0])).not.toContain("mem_private")
    expect(JSON.stringify(audits[0])).not.toContain(privateReason)
  })
})
