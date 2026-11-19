import { describe, expect, it } from "vitest"

import { createDecisionModelStore } from "../../domains/decision-model/create-decision-model-store/index.ts"
import { prisma } from "../../integrations/prisma/index.ts"

describe("decision runtime deletions", () => {
  it("persists safe copy references and reconciles a receipt across store recreation", async () => {
    const user = await prisma.user.create({ data: {} })
    const membership = await prisma.membership.create({ data: { userId: user.id } })
    const repository = await prisma.repository.create({
      data: { nameWithOwner: "team/privacy", defaultBranch: "main" },
    })
    const store = createDecisionModelStore(prisma, {
      authorizeRepositoryAdministration: () => Promise.resolve(true),
    })
    const deletion = await store.createOrGetDeletion!({
      repositoryId: repository.id,
      requestedByMembershipId: membership.id,
      idempotencyKey: "withdraw-grant-1",
      selectors: { grantId: "grant-1" },
      reason: "training consent withdrawn",
    })
    await store.saveRuntimeCopies!(repository.id, [
      {
        id: "copy-1",
        runtimeCopyId: "copy-1",
        kind: "candidate",
        sourceTrainingExportId: "export-1",
        permittingGrantIds: ["grant-1"],
        evidenceDigest: `sha256:${"a".repeat(64)}`,
        tasksetDigest: `sha256:${"b".repeat(64)}`,
        useState: "revoked",
        promotionState: "ineligible",
        storage: { connector: "local", reference: "candidate:1" },
        retention: { mode: "delete_on_withdrawal" },
        createdAt: "2026-11-19T18:00:00.000Z",
      },
    ])
    await expect(
      prisma.decisionRuntimeCopy.findUniqueOrThrow({
        where: {
          repositoryId_runtimeCopyId: {
            repositoryId: repository.id,
            runtimeCopyId: "copy-1",
          },
        },
        select: {
          runtimeConnector: true,
          runtimeReference: true,
          grantIds: true,
        },
      }),
    ).resolves.toEqual({
      runtimeConnector: "local",
      runtimeReference: "candidate:1",
      grantIds: ["grant-1"],
    })
    await store.updateDeletionReceipt!(deletion.id, {
      id: "deletion-1",
      state: "pending",
      selectors: { grantId: "grant-1" },
      items: [],
      pendingItems: [
        {
          kind: "candidate",
          runtimeCopyId: "copy-1",
          code: "delete_unavailable",
          retryable: true,
        },
      ],
      failures: [],
      revokedAt: "2026-11-19T18:00:00.000Z",
      updatedAt: "2026-11-19T18:00:00.000Z",
    })

    const reopened = createDecisionModelStore(prisma)
    expect(await reopened.listPendingDeletions!()).toEqual([
      expect.objectContaining({ id: deletion.id, runtimeDeletionId: "deletion-1" }),
    ])
    await reopened.updateDeletionReceipt!(deletion.id, {
      id: "deletion-1",
      state: "completed",
      selectors: { grantId: "grant-1" },
      items: [
        {
          kind: "candidate",
          runtimeCopyId: "copy-1",
          state: "deleted",
          storage: { connector: "local", reference: "candidate:1" },
          retention: { mode: "delete_on_withdrawal" },
        },
      ],
      pendingItems: [],
      failures: [],
      revokedAt: "2026-11-19T18:00:00.000Z",
      completedAt: "2026-11-19T18:01:00.000Z",
      updatedAt: "2026-11-19T18:01:00.000Z",
    })

    expect(await reopened.listPendingDeletions!()).toEqual([])
    expect(
      await prisma.decisionRuntimeDeletion.findUniqueOrThrow({
        where: { id: deletion.id },
        select: { receipt: true },
      }),
    ).toEqual({
      receipt: expect.objectContaining({
        items: [
          expect.objectContaining({
            storage: { connector: "local", reference: "candidate:1" },
            retention: { mode: "delete_on_withdrawal" },
          }),
        ],
      }),
    })
    expect(
      await prisma.securityAudit.count({
        where: { action: "decision.runtime_deletion.completed" },
      }),
    ).toBe(1)
  })
})
