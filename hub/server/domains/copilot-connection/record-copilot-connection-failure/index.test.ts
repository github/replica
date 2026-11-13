import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { CopilotConnectionTransactionRepositories } from "../types"
import { recordCopilotConnectionFailure } from "."

describe("recordCopilotConnectionFailure()", () => {
  it("locks before rereading authority and attributes the failure to the live actor", async () => {
    const membershipId = randomUUID()
    const auditId = randomUUID()
    const lockState = vi.fn().mockResolvedValue({ generation: 1n })
    const lockAdministratorSession = vi.fn().mockResolvedValue({ membershipId })
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const records = {
      advanceState: vi.fn(),
      clearRefusal: vi.fn(),
      deleteConnection: vi.fn(),
      lockAdministratorSession,
      getConnection: vi.fn(),
      lockState,
      recordRefusal: vi.fn(),
      replaceConnection: vi.fn(),
      writeAudit,
    } satisfies CopilotConnectionTransactionRepositories

    await expect(
      recordCopilotConnectionFailure(
        {
          credentialProvider: "environment_token",
          sessionDigest: "session-digest",
        },
        {
          createId: () => auditId,
          runTransaction: (operation) => operation(records),
        },
      ),
    ).resolves.toBe(true)

    expect(lockState.mock.invocationCallOrder[0]).toBeLessThan(
      lockAdministratorSession.mock.invocationCallOrder[0]!,
    )
    expect(writeAudit).toHaveBeenCalledWith({
      actorMembershipId: membershipId,
      credentialProvider: "environment_token",
      id: auditId,
      phase: "failed",
      reason: "status_check_failed",
      type: "copilot_connection",
    })
  })

  it("includes the GitHub App and billed organization in a provider failure audit", async () => {
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const records = {
      advanceState: vi.fn(),
      clearRefusal: vi.fn(),
      deleteConnection: vi.fn(),
      lockAdministratorSession: vi.fn().mockResolvedValue({ membershipId: randomUUID() }),
      getConnection: vi.fn(),
      lockState: vi.fn().mockResolvedValue({ generation: 1n }),
      recordRefusal: vi.fn(),
      replaceConnection: vi.fn(),
      writeAudit,
    } satisfies CopilotConnectionTransactionRepositories

    await recordCopilotConnectionFailure(
      {
        appId: "123",
        billedOrganization: "github",
        credentialProvider: "github_app_installation",
        sessionDigest: "session-digest",
      },
      { createId: randomUUID, runTransaction: (operation) => operation(records) },
    )

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "123",
        billedOrganization: "github",
        credentialProvider: "github_app_installation",
        phase: "failed",
      }),
    )
  })
})
