import { describe, expect, it, vi } from "vitest"

import type { SessionRestoreRepositories } from "../run-session-restore-transaction/types"
import { restoreHubSession } from "."

function repositories(
  overrides: Partial<SessionRestoreRepositories> = {},
): SessionRestoreRepositories {
  const membership = {
    id: "membership-id",
    lifecycle: "ACTIVE" as const,
    userId: "user-id",
  }
  const session = {
    externalIdentityId: "external-identity-id",
    id: "session-id",
    membershipId: "membership-id",
    revocationRevision: 0,
  }
  return {
    findSession: vi.fn().mockResolvedValue(session),
    getActiveProviderKeys: vi.fn().mockResolvedValue(["entra"]),
    getRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
    lockRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
    lockActiveAssignments: vi
      .fn()
      .mockResolvedValue([
        { id: "assignment-id", role: "MEMBER", source: "AUTHENTICATION_PROVIDER" },
      ]),
    lockMembership: vi.fn().mockResolvedValue(membership),
    lockProvider: vi.fn().mockResolvedValue({ enabled: true, id: "provider-id" }),
    lockSession: vi.fn().mockResolvedValue(session),
    ...overrides,
  }
}

describe("restoreHubSession()", () => {
  it("restores through the session's immutable membership authority", async () => {
    const records = repositories()

    await expect(
      restoreHubSession("a".repeat(64), {
        runTransaction: (operation) => operation(records),
      }),
    ).resolves.toEqual({
      externalIdentityId: "external-identity-id",
      membershipId: "membership-id",
      userId: "user-id",
      role: "MEMBER",
    })
  })

  it("locks providers before revision and membership authority", async () => {
    const order: string[] = []
    const records = repositories({
      getActiveProviderKeys: vi.fn().mockResolvedValue(["entra", "github"]),
      lockProvider: vi.fn().mockImplementation((key: string) => {
        order.push(`provider:${key}`)
        return Promise.resolve({ enabled: true, id: "provider-id" })
      }),
      lockRevocation: vi.fn().mockImplementation(() => {
        order.push("revocation")
        return Promise.resolve({ revision: 0 })
      }),
      lockMembership: vi.fn().mockImplementation(() => {
        order.push("membership")
        return Promise.resolve({
          id: "membership-id",
          lifecycle: "ACTIVE",
          userId: "user-id",
        })
      }),
      lockActiveAssignments: vi.fn().mockImplementation(() => {
        order.push("assignments")
        return Promise.resolve([
          { id: "assignment-id", role: "MEMBER", source: "AUTHENTICATION_PROVIDER" },
        ])
      }),
      lockSession: vi.fn().mockImplementation(() => {
        order.push("session")
        return Promise.resolve({
          externalIdentityId: "external-identity-id",
          id: "session-id",
          membershipId: "membership-id",
          revocationRevision: 0,
        })
      }),
    })

    await restoreHubSession("a".repeat(64), {
      runTransaction: (operation) => operation(records),
    })

    expect(order).toEqual([
      "provider:entra",
      "provider:github",
      "revocation",
      "membership",
      "assignments",
      "session",
    ])
  })

  it("fails closed when global revocation authority is missing", async () => {
    const lockMembership = vi.fn()
    const records = repositories({
      getRevocation: vi.fn().mockResolvedValue(null),
      lockMembership,
    })

    await expect(
      restoreHubSession("a".repeat(64), {
        runTransaction: (operation) => operation(records),
      }),
    ).resolves.toBeNull()
    expect(lockMembership).not.toHaveBeenCalled()
  })

  it("fails closed when an assignment provider is disabled", async () => {
    const lockMembership = vi.fn()
    const records = repositories({
      lockMembership,
      lockProvider: vi.fn().mockResolvedValue({
        enabled: false,
        id: "provider-id",
      }),
    })

    await expect(
      restoreHubSession("a".repeat(64), {
        runTransaction: (operation) => operation(records),
      }),
    ).resolves.toBeNull()
    expect(lockMembership).not.toHaveBeenCalled()
  })

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

  it("fails closed when the session expires while authority locks are acquired", async () => {
    const lockSession = vi.fn().mockResolvedValue(null)
    const records = repositories({ lockSession })

    await expect(
      restoreHubSession("a".repeat(64), {
        runTransaction: (operation) => operation(records),
      }),
    ).resolves.toBeNull()
    expect(lockSession).toHaveBeenCalledOnce()
  })

  it.each(["SUSPENDED", "REMOVED"] as const)(
    "denies a retained session for a %s membership",
    async (lifecycle) => {
      const records = repositories({
        lockMembership: vi.fn().mockResolvedValue({
          id: "membership-id",
          lifecycle,
          userId: "user-id",
        }),
      })

      await expect(
        restoreHubSession("a".repeat(64), {
          runTransaction: (operation) => operation(records),
        }),
      ).resolves.toBeNull()
    },
  )

  it("returns administrator when any active assignment grants administrator authority", async () => {
    const records = repositories({
      getActiveProviderKeys: vi.fn().mockResolvedValue([]),
      lockActiveAssignments: vi.fn().mockResolvedValue([
        { id: "provider-assignment", role: "MEMBER", source: "AUTHENTICATION_PROVIDER" },
        { id: "bootstrap-assignment", role: "ADMINISTRATOR", source: "BOOTSTRAP" },
      ]),
    })

    await expect(
      restoreHubSession("a".repeat(64), {
        runTransaction: (operation) => operation(records),
      }),
    ).resolves.toEqual({
      externalIdentityId: "external-identity-id",
      membershipId: "membership-id",
      userId: "user-id",
      role: "ADMINISTRATOR",
    })
  })
})
