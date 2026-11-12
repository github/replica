import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "../errors"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types"
import { designateHubAdministrators } from "."

describe("designateHubAdministrators()", () => {
  it.each([
    ["an empty selection", []],
    ["a duplicate selection", [randomUUID(), randomUUID()].flatMap((id) => [id, id])],
    ["more than fifty memberships", Array.from({ length: 51 }, () => randomUUID())],
  ])("rejects %s before persistence work", async (_case, targetMembershipIds) => {
    const actorMembershipId = randomUUID()
    const auditId = randomUUID()
    const runTransaction = vi.fn()
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: actorMembershipId.toUpperCase(),
          targetMembershipIds,
        },
        { createId: () => auditId, runTransaction, writeAudit },
      ),
    ).rejects.toMatchObject({ reason: "invalid_selection" })
    expect(runTransaction).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith({
      actorMembershipId,
      id: auditId,
      operation: "designate",
      reason: "invalid_selection",
      type: "administrator_management_denied",
    })
  })

  it("audits an invalid actor as an anonymous invalid selection without persistence work", async () => {
    const auditId = randomUUID()
    const runTransaction = vi.fn()
    const writeAudit = vi.fn().mockResolvedValue(undefined)

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: "invalid",
          targetMembershipIds: [randomUUID()],
        },
        { createId: () => auditId, runTransaction, writeAudit },
      ),
    ).rejects.toMatchObject({ reason: "invalid_selection" })

    expect(runTransaction).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith({
      actorMembershipId: null,
      id: auditId,
      operation: "designate",
      reason: "invalid_selection",
      type: "administrator_management_denied",
    })
  })

  it("uses the bounded retry policy for serialization conflicts", async () => {
    const runTransaction = vi
      .fn()
      .mockRejectedValue(new AdministratorManagementTransactionConflictError())

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: randomUUID(),
          targetMembershipIds: [randomUUID()],
        },
        { createId: randomUUID, runTransaction, writeAudit: vi.fn() },
      ),
    ).rejects.toBeInstanceOf(AdministratorManagementPersistenceError)
    expect(runTransaction).toHaveBeenCalledTimes(3)
  })

  it("normalizes uppercase membership UUIDs before authority and target comparisons", async () => {
    const actorMembershipId = randomUUID()
    const targetMembershipId = randomUUID()
    const records = {
      createAssignment: vi.fn().mockResolvedValue({ id: randomUUID() }),
      createSecurityAudit: vi.fn().mockResolvedValue(undefined),
      endOpenSessions: vi.fn().mockResolvedValue([]),
      lockActiveAssignment: vi.fn(),
      lockEffectiveAdministratorAssignments: vi.fn().mockResolvedValue([]),
      lockEffectiveAdministratorProviders: vi.fn().mockResolvedValue([]),
      lockEffectiveAdministrators: vi.fn().mockResolvedValue([{ membershipId: actorMembershipId }]),
      lockTargets: vi.fn().mockResolvedValue([
        {
          externalIdentityId: randomUUID(),
          lifecycle: "ACTIVE",
          membershipId: targetMembershipId,
        },
      ]),
      revokeAssignment: vi.fn(),
    } satisfies AdministratorManagementRepositories

    await expect(
      designateHubAdministrators(
        {
          actorMembershipId: actorMembershipId.toUpperCase(),
          targetMembershipIds: [targetMembershipId.toUpperCase()],
        },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        membershipId: targetMembershipId,
      }),
    ])
    expect(records.lockTargets).toHaveBeenCalledWith([targetMembershipId])
    expect(records.lockEffectiveAdministratorAssignments).toHaveBeenCalledWith([actorMembershipId])
    expect(records.createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId,
        targetMembershipId,
      }),
    )
  })
})
