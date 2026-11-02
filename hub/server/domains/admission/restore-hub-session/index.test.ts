import { describe, expect, it, vi } from "vitest"

import type { SessionRestoreRepositories } from "../run-session-restore-transaction/types"
import { restoreHubSession } from "."

function repositories(
  overrides: Partial<SessionRestoreRepositories> = {},
): SessionRestoreRepositories {
  return {
    getRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
    lockActiveAssignment: vi.fn().mockResolvedValue({ role: "ADMINISTRATOR" }),
    lockMembership: vi.fn().mockResolvedValue({
      id: "membership-id",
      lifecycle: "ACTIVE",
    }),
    lockSession: vi.fn().mockResolvedValue({
      id: "session-id",
      membershipId: "membership-id",
      revocationRevision: 0,
      userId: "user-id",
    }),
    ...overrides,
  }
}

describe("restoreHubSession()", () => {
  it("fails closed when revocation changes before the final reread", async () => {
    let rereadRevision = 0
    let firstReadComplete!: () => void
    const firstRead = new Promise<void>((resolve) => {
      firstReadComplete = resolve
    })
    let releaseFinalRead!: () => void
    const finalRead = new Promise<void>((resolve) => {
      releaseFinalRead = resolve
    })
    let reads = 0
    const records = repositories({
      getRevocation: vi.fn(async () => {
        reads += 1
        if (reads === 1) firstReadComplete()
        if (reads === 2) await finalRead
        return { revision: rereadRevision }
      }),
    })
    const restoration = restoreHubSession("a".repeat(64), {
      runTransaction: (operation) => operation(records),
    })

    await firstRead
    rereadRevision = 1
    releaseFinalRead()

    await expect(restoration).resolves.toBeNull()
    expect(reads).toBe(2)
  })

  it.each(["SUSPENDED", "REMOVED"] as const)(
    "denies a retained session for a %s membership",
    async (lifecycle) => {
      const records = repositories({
        lockMembership: vi.fn().mockResolvedValue({
          id: "membership-id",
          lifecycle,
        }),
      })

      await expect(
        restoreHubSession("a".repeat(64), {
          runTransaction: (operation) => operation(records),
        }),
      ).resolves.toBeNull()
    },
  )
})
