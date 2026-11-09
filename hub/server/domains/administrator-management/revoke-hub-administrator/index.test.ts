import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types"
import { revokeHubAdministrator } from "."

describe("revokeHubAdministrator()", () => {
  it("normalizes uppercase membership UUIDs before authority and target comparisons", async () => {
    const actorMembershipId = randomUUID()
    const targetMembershipId = randomUUID()
    const assignmentId = randomUUID()
    const records = {
      createAssignment: vi.fn(),
      createSecurityAudit: vi.fn().mockResolvedValue(undefined),
      endOpenSessions: vi.fn().mockResolvedValue([]),
      lockActiveAssignment: vi.fn().mockResolvedValue({ id: assignmentId }),
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
    expect(records.createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId,
        targetMembershipId,
      }),
    )
  })
})
