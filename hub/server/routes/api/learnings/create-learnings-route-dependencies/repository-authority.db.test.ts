import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value"
import { executeLearningDecision } from "../../../../domains/learning/execute-learning-decision"
import { getLearningOverview } from "../../../../domains/learning/get-learning-overview"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/execute-learning-decision", () => ({
  executeLearningDecision: vi.fn(),
}))
vi.mock("../../../../domains/learning/get-learning-overview", () => ({
  getLearningOverview: vi.fn(),
}))

describe("learning overview repository visibility", () => {
  it("returns no data when an ID-backed repository is removed while its overview loads", async () => {
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
    await prisma.hubSession.create({
      data: {
        digest: hashAuthenticationValue("test"),
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
    await prisma.repositoryAccessGrant.create({
      data: {
        accessLevel: "ADMIN",
        membershipId: membership.id,
        observedAt: new Date(),
        repositoryId: repository.id,
      },
    })
    const restore = vi.fn().mockResolvedValue({
      membershipId: membership.id,
      userId: user.id,
      provider: "github",
      sessionProvider: "github",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const origin = "https://hub.example.test"
    vi.mocked(getLearningOverview).mockImplementationOnce(async () => {
      await prisma.repository.update({
        data: { removedAt: new Date() },
        where: { id: repository.id },
      })
      return {
        loadError: null,
        identityReviewCount: 1,
        suggestions: [],
        learnings: [],
        rejected: [],
        shared: [],
        recall: { text: "private recall", count: 1 },
      }
    })
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: origin, DATABASE_URL: getDatabaseUrl() },
      { restore },
      pino({ level: "silent" }),
    )
    const server = createServer(
      createApp({
        authentication: {
          currentSession: { restore },
          signOut: { applicationOrigin: origin, secureCookie: false, end: vi.fn() },
        },
        learnings,
      }),
    )
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(
        `http://127.0.0.1:${port}/api/repositories/${repository.id}/learnings`,
        { headers: { cookie: "hub_session=test" } },
      )
      const body = await response.text()

      expect(vi.mocked(getLearningOverview)).toHaveBeenCalledOnce()
      expect(response.status).toBe(404)
      expect(JSON.parse(body)).toEqual({
        code: "repository_not_found",
        error: "Repository not found.",
      })
      expect(body).not.toContain("private recall")
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})

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
