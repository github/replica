import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { findGitHubWebhookEvidence } from "."

describe("findGitHubWebhookEvidence()", () => {
  it("observes only the requested receipt and repository/run Build without changing them", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main", githubRepositoryId: 56 },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "proto/demo" },
    })
    const build = await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        githubWorkflowRunId: 7,
        githubWorkflowRunAttempt: 1,
        workflowCompletedAt: new Date(),
      },
    })
    const deliveryGuid = randomUUID()
    const receipt = await prisma.gitHubWebhookDelivery.create({
      data: { id: deliveryGuid, event: "workflow_run", payloadDigest: "a".repeat(64) },
    })
    const input = { deliveryGuid, githubRepositoryId: 56, runId: 7 }
    expect(await findGitHubWebhookEvidence(prisma, input)).toMatchObject({
      receipt: { event: "workflow_run", createdAt: receipt.createdAt },
      redelivery: null,
      build: {
        state: "successful",
        owningAttempt: 1,
        completedAttempt: 1,
        completedAt: build.workflowCompletedAt,
      },
    })
    expect(
      (await findGitHubWebhookEvidence(prisma, { ...input, githubRepositoryId: 99 })).build,
    ).toBeNull()
    expect((await findGitHubWebhookEvidence(prisma, { ...input, runId: 8 })).build).toBeNull()
    expect(
      (await findGitHubWebhookEvidence(prisma, { ...input, deliveryGuid: randomUUID() })).receipt,
    ).toBeNull()
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toEqual(build)
    expect(await prisma.gitHubWebhookDelivery.findUnique({ where: { id: deliveryGuid } })).toEqual(
      receipt,
    )
  })

  it("finds a contributing run's own completed attempt rather than the dist owner's watermark", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "octo/demo", defaultBranch: "main", githubRepositoryId: 56 },
    })
    const prototype = await prisma.prototype.create({
      data: { repositoryId: repository.id, branchName: "proto/demo" },
    })
    const completionTime = new Date("2026-01-02T00:00:00Z")
    await prisma.build.create({
      data: {
        prototypeId: prototype.id,
        number: 1,
        state: "successful",
        githubWorkflowRunId: 7,
        githubWorkflowRunAttempt: 1,
        workflowCompletedAt: new Date("2026-01-01T00:00:00Z"),
        githubRunCompletions: {
          create: { githubWorkflowRunId: 8, runAttempt: 2, completedAt: completionTime },
        },
      },
    })

    const evidence = await findGitHubWebhookEvidence(prisma, {
      deliveryGuid: randomUUID(),
      githubRepositoryId: 56,
      runId: 8,
    })
    expect(evidence.build).toEqual({
      state: "successful",
      owningAttempt: null,
      completedAttempt: 2,
      completedAt: completionTime,
    })
  })
})
