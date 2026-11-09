import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types"
import { revokeHubAdministrator } from "."

describe("revokeHubAdministrator()", () => {
  it.each([
    {
      actorMembershipId: randomUUID().toUpperCase(),
      expectedActorMembershipId: undefined,
      name: "an invalid target",
      targetMembershipId: "invalid",
    },
    {
      actorMembershipId: "invalid",
      expectedActorMembershipId: null,
      name: "invalid actor and target IDs",
      targetMembershipId: "invalid",
    },
  ])("rejects $name before persistence work", async (input) => {
    const auditId = randomUUID()
    const runTransaction = vi.fn()
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const expectedActorMembershipId =
      input.expectedActorMembershipId === undefined
        ? input.actorMembershipId.toLowerCase()
        : input.expectedActorMembershipId

    await expect(
      revokeHubAdministrator(
        {
          actorMembershipId: input.actorMembershipId,
          targetMembershipId: input.targetMembershipId,
        },
        { createId: () => auditId, runTransaction, writeAudit },
      ),
    ).rejects.toMatchObject({ reason: "invalid_target" })

    expect(runTransaction).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith({
      actorMembershipId: expectedActorMembershipId,
      id: auditId,
      operation: "revoke",
      reason: "invalid_target",
      type: "administrator_management_denied",
    })
  })

  it("normalizes uppercase membership UUIDs before authority and target comparisons", async () => {
    const actorMembershipId = randomUUID()
    const targetMembershipId = randomUUID()
    const assignmentId = randomUUID()
    const records = {
      createAssignment: vi.fn(),
      createSecurityAudit: vi.fn().mockResolvedValue(undefined),
      endOpenSessions: vi.fn().mockResolvedValue([]),
      lockActiveAssignment: vi.fn().mockResolvedValue({ id: assignmentId }),
      lockEffectiveAdministratorAssignments: vi.fn().mockResolvedValue([]),
      lockEffectiveAdministratorProviders: vi.fn().mockResolvedValue([]),
      lockEffectiveAdministrators: vi
        .fn()
        .mockResolvedValueOnce([{ membershipId: actorMembershipId }])
        .mockResolvedValueOnce([{ membershipId: actorMembershipId }]),
      lockTargets: vi.fn().mockResolvedValue([
        {
          externalIdentityId: randomUUID(),
          lifecycle: "ACTIVE",
          membershipId: targetMembershipId,
        },
      ]),
      revokeAssignment: vi.fn().mockResolvedValue(undefined),
    } satisfies AdministratorManagementRepositories

    await expect(
      revokeHubAdministrator(
        {
          actorMembershipId: actorMembershipId.toUpperCase(),
          targetMembershipId: targetMembershipId.toUpperCase(),
        },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toEqual({ assignmentId, membershipId: targetMembershipId })
    expect(records.lockTargets).toHaveBeenCalledWith([targetMembershipId])
    expect(records.lockActiveAssignment).toHaveBeenCalledWith(targetMembershipId)
    expect(records.lockEffectiveAdministratorAssignments).toHaveBeenCalledWith([actorMembershipId])
    expect(records.createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId,
        targetMembershipId,
      }),
    )
  })
})
