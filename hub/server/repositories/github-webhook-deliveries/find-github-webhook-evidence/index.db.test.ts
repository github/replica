import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma/index.ts"
import { findGitHubWebhookEvidence } from "./index.ts"

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
      build: { state: "successful", workflowCompletedAt: build.workflowCompletedAt },
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
})
