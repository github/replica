import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { CopilotConnectionTransactionRepositories } from "../types"
import { recordCopilotConnectionRefusal } from "."

function repositories(
  overrides: Partial<CopilotConnectionTransactionRepositories> = {},
): CopilotConnectionTransactionRepositories {
  return {
    advanceState: vi.fn().mockResolvedValue(undefined),
    clearRefusal: vi.fn().mockResolvedValue(undefined),
    deleteConnection: vi.fn().mockResolvedValue(false),
    findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
    getConnection: vi.fn().mockResolvedValue({
      credentialDigest: "a".repeat(64),
      credentialProvider: "environment_token",
      id: randomUUID(),
    }),
    lockState: vi.fn().mockResolvedValue({ generation: 1n }),
    recordRefusal: vi.fn().mockResolvedValue(true),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("recordCopilotConnectionRefusal()", () => {
  it("locks before rereading authority and advances generation with the refusal audit", async () => {
    const membershipId = randomUUID()
    const connectionId = randomUUID()
    const auditId = randomUUID()
    const at = new Date("2026-11-12T12:00:00Z")
    const records = repositories({
      findAdministratorSession: vi.fn().mockResolvedValue({ membershipId }),
      getConnection: vi.fn().mockResolvedValue({
        credentialDigest: "a".repeat(64),
        credentialProvider: "environment_token",
        id: connectionId,
      }),
    })

    await expect(
      recordCopilotConnectionRefusal(
        {
          at,
          credentialDigest: "a".repeat(64),
          credentialProvider: "environment_token",
          sessionDigest: "session-digest",
          snapshot: { connectionId, generation: 1n },
        },
        {
          createId: () => auditId,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toBe("recorded")

    expect(vi.mocked(records.lockState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(records.findAdministratorSession).mock.invocationCallOrder[0]!,
    )
    expect(records.recordRefusal).toHaveBeenCalledWith({
      credentialDigest: "a".repeat(64),
      credentialProvider: "environment_token",
      refusedAt: at,
    })
    expect(records.advanceState).toHaveBeenCalledOnce()
    expect(records.writeAudit).toHaveBeenCalledWith({
      actorMembershipId: membershipId,
      connectionId,
      credentialProvider: "environment_token",
      id: auditId,
      phase: "denied",
      reason: "credential_refused",
      type: "copilot_connection",
    })
  })

  it("advances generation even when there is no connection row to mark refused", async () => {
    const records = repositories({ getConnection: vi.fn().mockResolvedValue(null) })

    await expect(
      recordCopilotConnectionRefusal(
        {
          at: new Date(),
          credentialDigest: "a".repeat(64),
          credentialProvider: "environment_token",
          sessionDigest: "session-digest",
          snapshot: { connectionId: null, generation: 1n },
        },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toBe("recorded")

    expect(records.recordRefusal).toHaveBeenCalledOnce()
    expect(records.advanceState).toHaveBeenCalledOnce()
  })

  it("does not advance or audit when refusal state cannot be recorded", async () => {
    const records = repositories({ recordRefusal: vi.fn().mockResolvedValue(false) })

    await expect(
      recordCopilotConnectionRefusal(
        {
          at: new Date(),
          credentialDigest: "a".repeat(64),
          credentialProvider: "environment_token",
          sessionDigest: "session-digest",
          snapshot: { connectionId: (await records.getConnection())!.id, generation: 1n },
        },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toBe("connection_changed")

    expect(records.advanceState).not.toHaveBeenCalled()
    expect(records.writeAudit).not.toHaveBeenCalled()
  })
})
