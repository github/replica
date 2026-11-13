import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { CopilotConnectionTransactionRepositories } from "../types"
import { disconnectCopilot } from "."

function repositories(
  overrides: Partial<CopilotConnectionTransactionRepositories> = {},
): CopilotConnectionTransactionRepositories {
  return {
    advanceState: vi.fn().mockResolvedValue(undefined),
    clearRefusal: vi.fn().mockResolvedValue(undefined),
    deleteConnection: vi.fn().mockResolvedValue(true),
    lockAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
    getConnection: vi.fn().mockResolvedValue({ id: randomUUID() }),
    lockState: vi.fn().mockResolvedValue({ generation: 1n }),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    recordRefusal: vi.fn().mockResolvedValue(false),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("disconnectCopilot()", () => {
  it("rereads administrator authority after locking the connection state", async () => {
    const records = repositories({
      lockAdministratorSession: vi.fn().mockResolvedValue(null),
    })

    await expect(
      disconnectCopilot(
        { sessionDigest: "session-digest" },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).rejects.toMatchObject({ code: "not_authorized" })

    expect(records.lockState).toHaveBeenCalledOnce()
    expect(records.lockAdministratorSession).toHaveBeenCalledWith("session-digest")
    expect(vi.mocked(records.lockState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(records.lockAdministratorSession).mock.invocationCallOrder[0]!,
    )
    expect(records.getConnection).not.toHaveBeenCalled()
    expect(records.deleteConnection).not.toHaveBeenCalled()
  })

  it.each([
    ["the connection is absent", null, true],
    ["the connection delete does not succeed", { id: randomUUID() }, false],
  ])("does not advance or audit when %s", async (_label, connection, deleted) => {
    const records = repositories({
      deleteConnection: vi.fn().mockResolvedValue(deleted),
      getConnection: vi.fn().mockResolvedValue(connection),
    })

    await expect(
      disconnectCopilot(
        { sessionDigest: "session-digest" },
        {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).rejects.toMatchObject({ code: "not_connected" })

    expect(records.advanceState).not.toHaveBeenCalled()
    expect(records.writeAudit).not.toHaveBeenCalled()
  })

  it("advances generation and writes the exact actor and connection audit", async () => {
    const actorMembershipId = randomUUID()
    const connectionId = randomUUID()
    const auditId = randomUUID()
    const records = repositories({
      lockAdministratorSession: vi.fn().mockResolvedValue({ membershipId: actorMembershipId }),
      getConnection: vi.fn().mockResolvedValue({
        credentialDigest: "a".repeat(64),
        credentialProvider: "environment_token",
        id: connectionId,
      }),
    })

    await expect(
      disconnectCopilot(
        { sessionDigest: "session-digest" },
        {
          createId: () => auditId,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toEqual({ disconnected: true })

    expect(records.clearRefusal).toHaveBeenCalledOnce()
    expect(records.advanceState).toHaveBeenCalledOnce()
    expect(records.writeAudit).toHaveBeenCalledWith({
      actorMembershipId,
      connectionId,
      credentialProvider: "environment_token",
      id: auditId,
      phase: "disconnected",
      type: "copilot_connection",
    })
  })
})
