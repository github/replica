import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { hashAuthenticationValue } from "../../../../domains/authentication/hash-authentication-value"
import { executeLearningDecision } from "../../../../domains/learning/execute-learning-decision"
import { LearningCommandError } from "../../../../integrations/learning/run-learning-command/errors"
import { prisma } from "../../../../integrations/prisma"
import { getDatabaseUrl } from "../../../../../test/database/get-database-url"
import { createLearningsRouteDependencies } from "."

vi.mock("../../../../domains/learning/execute-learning-decision", () => ({
  executeLearningDecision: vi.fn(),
}))

describe("learning decision visibility during scoping activation", () => {
  it.each([
    {
      name: "hides a definitive rejection after repository removal and records failure",
      removeRepository: true,
      errorCode: "stale_review",
      status: 404,
      responseCode: "repository_not_found",
      pending: 0,
    },
    {
      name: "preserves the stale-review response for an identified repository",
      removeRepository: false,
      errorCode: "stale_review",
      status: 409,
      responseCode: "stale_review",
      pending: 0,
    },
    {
      name: "hides an uncertain error after repository removal and retains its recovery marker",
      removeRepository: true,
      errorCode: "learning_failed",
      status: 404,
      responseCode: "repository_not_found",
      pending: 1,
    },
  ])("$name", async ({ removeRepository, errorCode, status, responseCode, pending }) => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/example", defaultBranch: "main", githubRepositoryId: 123n },
    })
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
      data: { userId: user.id, provider: "entra", issuer: "https://example.test", subject: "1" },
    })
    await prisma.membershipAssignment.create({
      data: {
        externalIdentityId: identity.id,
        membershipId: membership.id,
        role: "ADMINISTRATOR",
        source: "BOOTSTRAP",
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
    const restore = vi.fn().mockResolvedValue({
      membershipId: membership.id,
      userId: user.id,
      provider: "entra",
      sessionProvider: "entra",
      login: "mona",
      name: "Mona",
      role: "MEMBER",
    })
    const origin = "https://hub.example.test"
    const learnings = await createLearningsRouteDependencies(
      { HUB_APPLICATION_ORIGIN: origin, DATABASE_URL: getDatabaseUrl() },
      { restore },
      pino({ level: "silent" }),
    )
    const privateDetail = "synthetic-private-digest-123"
    const message = `The package store reports ${privateDetail}.`
    vi.mocked(executeLearningDecision).mockImplementationOnce(async () => {
      if (removeRepository) {
        await prisma.repository.update({
          data: { removedAt: new Date() },
          where: { id: repository.id },
        })
      }
      throw new LearningCommandError(errorCode, message)
    })
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
        `http://127.0.0.1:${port}/api/repositories/${repository.id}/learnings/mem_1/decision`,
        {
          method: "POST",
          headers: { cookie: "hub_session=test", origin, "content-type": "application/json" },
          body: JSON.stringify({ decision: "accept", digest: `sha256:${"a".repeat(64)}` }),
        },
      )
      const body = await response.text()
      const operations = await prisma.learningDecisionOperation.findMany({
        where: { repositoryId: repository.id },
      })
      const audits = await prisma.securityAudit.findMany({
        where: { action: "learning.accept", targetId: "mem_1" },
      })

      expect(vi.mocked(executeLearningDecision)).toHaveBeenCalledOnce()
      const storedRepository = await prisma.repository.findUniqueOrThrow({
        where: { id: repository.id },
      })
      expect(storedRepository).toEqual({
        ...repository,
        removedAt: storedRepository.removedAt,
        updatedAt: storedRepository.updatedAt,
      })
      expect(storedRepository.removedAt instanceof Date).toBe(removeRepository)
      expect(operations).toHaveLength(pending)
      if (pending === 0) {
        expect(audits).toHaveLength(1)
        expect(audits[0]).toMatchObject({
          outcome: "FAILURE",
          context: {
            actorMembershipId: membership.id,
            repositoryId: repository.id,
            reason: errorCode,
          },
        })
      } else {
        expect(audits).toHaveLength(0)
        expect(operations[0]).toMatchObject({
          actorMembershipId: membership.id,
          learningId: "mem_1",
        })
      }
      expect.soft(response.status).toBe(status)
      expect.soft(JSON.parse(body)).toMatchObject({ code: responseCode })
      if (removeRepository) {
        expect.soft(body).not.toContain(privateDetail)
      } else {
        expect(JSON.parse(body)).toEqual({ code: errorCode, error: message })
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
})
