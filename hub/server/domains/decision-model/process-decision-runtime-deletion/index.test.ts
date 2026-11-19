import { describe, expect, it, vi } from "vitest"

import type { DecisionModelDependencies } from "../types.ts"
import { processDecisionRuntimeDeletion } from "./index.ts"

describe("processDecisionRuntimeDeletion()", () => {
  it("persists disclosed copy references and the durable pending receipt", async () => {
    const saveRuntimeCopies = vi.fn()
    const updateDeletionReceipt = vi.fn()
    const dependencies = {
      authorization: { requireRepositoryAdministrator: vi.fn() },
      runtime: {
        listRuntimeCopies: vi.fn().mockResolvedValue({
          items: [
            {
              id: "copy-1",
              runtimeCopyId: "copy-1",
              kind: "taskset",
              sourceTrainingExportId: "export-1",
              permittingGrantIds: ["grant-1"],
              tasksetDigest: `sha256:${"a".repeat(64)}`,
              useState: "active",
              storage: { connector: "local", reference: "taskset:1" },
              retention: {},
            },
          ],
          nextCursor: null,
        }),
        requestDeletion: vi.fn().mockResolvedValue({
          id: "deletion-1",
          state: "pending",
          selectors: { grantId: "grant-1" },
          items: [],
          pendingItems: [
            {
              kind: "candidate",
              runtimeCopyId: "candidate-1",
              code: "delete_unavailable",
              retryable: true,
            },
          ],
          failures: [],
          revokedAt: "2026-11-19T18:00:00.000Z",
          updatedAt: "2026-11-19T18:00:00.000Z",
        }),
        getDeletion: vi.fn(),
      },
      store: {
        createOrGetDeletion: vi.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111",
          runtimeDeletionId: null,
          state: "PENDING",
        }),
        saveRuntimeCopies,
        updateDeletionReceipt,
      },
    } as unknown as DecisionModelDependencies

    await expect(
      processDecisionRuntimeDeletion(
        {
          repositoryId: "22222222-2222-4222-8222-222222222222",
          actorMembershipId: "33333333-3333-4333-8333-333333333333",
          actorLogin: "mona",
          selectors: { grantId: "grant-1" },
          reason: "training consent withdrawn",
          idempotencyKey: "delete-grant-1",
        },
        dependencies,
      ),
    ).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      state: "pending",
      pending: 1,
      failures: 0,
      completedAt: null,
    })
    expect(saveRuntimeCopies).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222", [
      expect.objectContaining({ runtimeCopyId: "copy-1" }),
    ])
    expect(updateDeletionReceipt).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({ id: "deletion-1", state: "pending" }),
    )
  })
})
