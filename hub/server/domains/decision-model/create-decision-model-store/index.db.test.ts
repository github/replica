import { describe, expect, it } from "vitest"

import { prisma } from "../../../integrations/prisma"
import { createDecisionModelStore } from "."

describe("createDecisionModelStore()", () => {
  it("keeps a taskset revoked when a disclosed permitting grant is withdrawn", async () => {
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/revoked-taskset", defaultBranch: "main" },
    })
    const user = await prisma.user.create({
      data: { membership: { create: {} } },
      include: { membership: true },
    })
    const tasksetDigest = `sha256:${"a".repeat(64)}`
    await prisma.decisionRuntimeCopy.create({
      data: {
        repositoryId: repository.id,
        runtimeCopyId: "copy-1",
        kind: "taskset",
        runtimeConnector: "fixture",
        runtimeReference: "taskset:1",
        grantIds: ["grant-secondary"],
        tasksetDigest,
        useState: "ready",
        retention: {},
        disclosedAt: new Date(),
      },
    })
    await prisma.decisionRuntimeDeletion.create({
      data: {
        repositoryId: repository.id,
        requestedByMembershipId: user.membership!.id,
        idempotencyKey: "withdrawal-secondary",
        state: "FAILED",
        grantId: "grant-secondary",
        reason: "Training consent was withdrawn.",
      },
    })

    await expect(
      createDecisionModelStore(prisma).isTasksetRevoked!({
        repositoryId: repository.id,
        exportId: "export-other",
        grantId: "grant-primary",
        evidenceDigest: `sha256:${"b".repeat(64)}`,
        tasksetDigest,
      }),
    ).resolves.toBe(true)
  })
})
