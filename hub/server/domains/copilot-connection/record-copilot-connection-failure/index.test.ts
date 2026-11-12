import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { CopilotConnectionTransactionRepositories } from "../types"
import { recordCopilotConnectionFailure } from "."

describe("recordCopilotConnectionFailure()", () => {
  it("locks before rereading authority and attributes the failure to the live actor", async () => {
    const membershipId = randomUUID()
    const auditId = randomUUID()
    const lockState = vi.fn().mockResolvedValue({ generation: 1n })
    const findAdministratorSession = vi.fn().mockResolvedValue({ membershipId })
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const records = {
      advanceState: vi.fn(),
      deleteConnection: vi.fn(),
      findAdministratorSession,
      getConnection: vi.fn(),
      lockState,
      refuseConnection: vi.fn(),
      replaceConnection: vi.fn(),
      writeAudit,
    } satisfies CopilotConnectionTransactionRepositories

    await expect(
      recordCopilotConnectionFailure(
        { sessionDigest: "session-digest" },
        {
          createId: () => auditId,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toBe(true)

    expect(lockState.mock.invocationCallOrder[0]).toBeLessThan(
      findAdministratorSession.mock.invocationCallOrder[0]!,
    )
    expect(writeAudit).toHaveBeenCalledWith({
      actorMembershipId: membershipId,
      id: auditId,
      phase: "failed",
      reason: "status_check_failed",
      type: "copilot_connection",
    })
  })
})
