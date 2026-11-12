import { createHash, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors"

import type { CopilotConnectionTransactionRepositories } from "../types"
import { connectCopilot } from "."

function repositories(
  overrides: Partial<CopilotConnectionTransactionRepositories> = {},
): CopilotConnectionTransactionRepositories {
  return {
    advanceState: vi.fn().mockResolvedValue(undefined),
    deleteConnection: vi.fn().mockResolvedValue(false),
    findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
    getConnection: vi.fn().mockResolvedValue(null),
    lockState: vi.fn().mockResolvedValue({ generation: 1n }),
    refuseConnection: vi.fn().mockResolvedValue(true),
    replaceConnection: vi.fn().mockResolvedValue(undefined),
    writeAudit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe("connectCopilot()", () => {
  it("rereads administrator authority after token validation", async () => {
    const records = repositories({ findAdministratorSession: vi.fn().mockResolvedValue(null) })
    const check = vi.fn().mockResolvedValue({ signedIn: true, login: "octocat", models: [] })

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "secret-token" },
        {
          check,
          createId: randomUUID,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
          now: () => new Date(),
          readSnapshot: vi.fn().mockResolvedValue({ connectionId: null, generation: 1n }),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal: vi.fn().mockResolvedValue("recorded"),
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "not_authorized" })

    expect(check).toHaveBeenCalledWith("secret-token")
    expect(vi.mocked(records.lockState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(records.findAdministratorSession).mock.invocationCallOrder[0]!,
    )
    expect(records.replaceConnection).not.toHaveBeenCalled()
    expect(records.writeAudit).not.toHaveBeenCalled()
  })

  it("rejects a stale connection generation after token validation", async () => {
    const records = repositories({
      lockState: vi.fn().mockResolvedValue({ generation: 2n }),
    })
    const check = vi.fn().mockResolvedValue({ signedIn: true, login: "octocat", models: [] })

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "secret-token" },
        {
          check,
          createId: randomUUID,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
          now: () => new Date(),
          readSnapshot: vi.fn().mockResolvedValue({ connectionId: null, generation: 1n }),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal: vi.fn().mockResolvedValue("recorded"),
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "connection_changed" })

    expect(records.replaceConnection).not.toHaveBeenCalled()
    expect(records.advanceState).not.toHaveBeenCalled()
    expect(records.writeAudit).not.toHaveBeenCalled()
  })

  it("persists only the token digest and advances generation with the typed audit", async () => {
    const actorMembershipId = randomUUID()
    const previousConnectionId = randomUUID()
    const connectionId = randomUUID()
    const auditId = randomUUID()
    const verifiedAt = new Date("2026-11-10T23:00:00Z")
    const records = repositories({
      findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: actorMembershipId }),
      getConnection: vi.fn().mockResolvedValue({ id: previousConnectionId }),
    })
    const createId = vi.fn().mockReturnValueOnce(connectionId).mockReturnValueOnce(auditId)

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "secret-token" },
        {
          check: vi.fn().mockResolvedValue({ signedIn: true, login: "octocat", models: ["gpt"] }),
          createId,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: actorMembershipId }),
          now: () => verifiedAt,
          readSnapshot: vi
            .fn()
            .mockResolvedValue({ connectionId: previousConnectionId, generation: 1n }),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal: vi.fn().mockResolvedValue("recorded"),
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toEqual({ connectionId })

    expect(records.replaceConnection).toHaveBeenCalledWith({
      connectedByMembershipId: actorMembershipId,
      id: connectionId,
      tokenDigest: createHash("sha256").update("secret-token").digest("hex"),
      verifiedAt,
    })
    const savedConnection = vi.mocked(records.replaceConnection).mock.calls[0]?.[0]
    expect(savedConnection).not.toHaveProperty("token")
    expect(records.advanceState).toHaveBeenCalledOnce()
    expect(records.writeAudit).toHaveBeenCalledWith({
      actorMembershipId,
      connectionId,
      id: auditId,
      phase: "connected",
      type: "copilot_connection",
    })
  })

  it("connects when no prior connection exists", async () => {
    const records = repositories()
    const connectionId = randomUUID()
    const auditId = randomUUID()
    const createId = vi.fn().mockReturnValueOnce(connectionId).mockReturnValueOnce(auditId)

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "secret-token" },
        {
          check: vi.fn().mockResolvedValue({ signedIn: true, login: "octocat", models: [] }),
          createId,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
          now: () => new Date(),
          readSnapshot: vi.fn().mockResolvedValue({ connectionId: null, generation: 1n }),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal: vi.fn().mockResolvedValue("recorded"),
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toEqual({ connectionId })
  })

  it("records a refused token against the checked generation without starting a connection transaction", async () => {
    const actorMembershipId = randomUUID()
    const connectionId = randomUUID()
    const checkedAt = new Date("2026-11-10T23:00:00Z")
    const snapshot = { connectionId, generation: 3n }
    const recordRefusal = vi.fn().mockResolvedValue("recorded")
    const runTransaction = vi.fn()
    const writeAudit = vi.fn()

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "refused-token" },
        {
          check: vi
            .fn()
            .mockRejectedValue(
              new LearningCommandError("unauthorized", "Copilot refused the token."),
            ),
          createId: randomUUID,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: actorMembershipId }),
          now: () => checkedAt,
          readSnapshot: vi.fn().mockResolvedValue(snapshot),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal,
          runTransaction,
          writeAudit,
        },
      ),
    ).rejects.toMatchObject({ code: "token_refused" })

    expect(recordRefusal).toHaveBeenCalledWith({
      at: checkedAt,
      sessionDigest: "session-digest",
      snapshot,
      tokenDigest: createHash("sha256").update("refused-token").digest("hex"),
    })
    expect(runTransaction).not.toHaveBeenCalled()
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("does not persist a refused token after administrator authority is lost", async () => {
    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "refused-token" },
        {
          check: vi
            .fn()
            .mockRejectedValue(
              new LearningCommandError("unauthorized", "Copilot refused the token."),
            ),
          createId: randomUUID,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
          now: () => new Date(),
          readSnapshot: vi.fn().mockResolvedValue({ connectionId: null, generation: 1n }),
          recordFailure: vi.fn().mockResolvedValue(true),
          recordRefusal: vi.fn().mockResolvedValue("not_authorized"),
          runTransaction: vi.fn(),
          writeAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "not_authorized" })
  })

  it("does not attribute a failed status check after administrator authority is lost", async () => {
    const recordFailure = vi.fn().mockResolvedValue(false)

    await expect(
      connectCopilot(
        { sessionDigest: "session-digest", token: "secret-token" },
        {
          check: vi.fn().mockRejectedValue(new Error("Copilot unavailable")),
          createId: randomUUID,
          findAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
          now: () => new Date(),
          readSnapshot: vi.fn().mockResolvedValue({ connectionId: null, generation: 1n }),
          recordFailure,
          recordRefusal: vi.fn().mockResolvedValue("recorded"),
          runTransaction: vi.fn(),
          writeAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "not_authorized" })

    expect(recordFailure).toHaveBeenCalledWith({ sessionDigest: "session-digest" })
  })
})
