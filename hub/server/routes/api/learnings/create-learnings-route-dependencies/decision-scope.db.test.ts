import { once } from "node:events"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import pino from "pino"
import { describe, expect, it, vi } from "vitest"

import { createApp } from "../../../../create-app"
import { activateGitHubRepositoryScoping } from "../../../../domains/identity/activate-github-repository-scoping"
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
      name: "hides a legacy repository's definitive rejection and records failure",
      githubRepositoryId: null,
      errorCode: "stale_review",
      status: 404,
      responseCode: "repository_not_found",
      pending: 0,
    },
    {
      name: "preserves the stale-review response for an identified repository",
      githubRepositoryId: 123n,
      errorCode: "stale_review",
      status: 409,
      responseCode: "stale_review",
      pending: 0,
    },
    {
      name: "hides an uncertain legacy decision error and retains its recovery marker",
      githubRepositoryId: null,
      errorCode: "learning_failed",
      status: 404,
      responseCode: "repository_not_found",
      pending: 1,
    },
  ])("$name", async ({ githubRepositoryId, errorCode, status, responseCode, pending }) => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/example", defaultBranch: "main", githubRepositoryId },
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
    const restore = vi.fn().mockResolvedValue({
      membershipId: membership.id,
      userId: user.id,
      provider: "entra",
      sessionProvider: "entra",
      login: "mona",
      name: "Mona",
      role: "ADMINISTRATOR",
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
      await prisma.$transaction(activateGitHubRepositoryScoping)
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
      expect(await prisma.repository.findUnique({ where: { id: repository.id } })).toEqual(
        repository,
      )
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
      if (githubRepositoryId === null) {
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
