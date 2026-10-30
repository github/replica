import { describe, expect, it, vi } from "vitest"

import { IdentityTransactionConflictError } from "../../identity/errors"
import type { AdmissionHandoffRepositories } from "../run-admission-handoff-transaction/types"
import { createAuthenticationAdmissionHandoff } from "."

function repositories(
  overrides: Partial<AdmissionHandoffRepositories> = {},
): AdmissionHandoffRepositories {
  return {
    consumeAdmissionHandoff: vi.fn(),
    createAdmissionHandoff: vi.fn(),
    createSecurityAudit: vi.fn(),
    findAdmissionHandoff: vi.fn(),
    findAuthenticationProvider: () =>
      Promise.resolve({
        id: "00000000-0000-4000-8000-000000000001",
        key: "github",
        selectedRevision: {
          id: "00000000-0000-4000-8000-000000000002",
          providerId: "00000000-0000-4000-8000-000000000001",
          revision: 1,
          configurationDigest: "a".repeat(64),
        },
      }),
    getAuthenticationRevocationGeneration: () => Promise.resolve(1n),
    lockAuthenticationProviderSelection: vi.fn(),
    lockAuthenticationRevocationGeneration: vi.fn(),
    ...overrides,
  }
}

const input = {
  browserBindingDigest: "b".repeat(64),
  displayAttributes: { login: "octocat", name: null, avatarUrl: null, email: null },
  expectedRevocationGeneration: 1n,
  expiresAt: new Date("2026-10-30T17:00:00Z"),
  externalIdentityId: "00000000-0000-4000-8000-000000000003",
  providerKey: "github",
  providerRevisionId: "00000000-0000-4000-8000-000000000002",
  tokenDigest: "c".repeat(64),
}

describe("createAuthenticationAdmissionHandoff()", () => {
  it("returns restart without creating or auditing after revision drift", async () => {
    const createAdmissionHandoff = vi.fn()
    const createSecurityAudit = vi.fn()
    const scoped = repositories({
      createAdmissionHandoff,
      createSecurityAudit,
      findAuthenticationProvider: () =>
        Promise.resolve({
          id: "00000000-0000-4000-8000-000000000001",
          key: "github",
          selectedRevision: {
            id: "00000000-0000-4000-8000-000000000004",
            providerId: "00000000-0000-4000-8000-000000000001",
            revision: 2,
            configurationDigest: "d".repeat(64),
          },
        }),
    })

    await expect(
      createAuthenticationAdmissionHandoff(input, {
        runTransaction: (operation) => operation(scoped),
      }),
    ).resolves.toEqual({ status: "restart", reason: "provider_revision_changed" })
    expect(createAdmissionHandoff).not.toHaveBeenCalled()
    expect(createSecurityAudit).not.toHaveBeenCalled()
  })

  it("uses the kernel retry boundary and returns restart after conflicts are exhausted", async () => {
    vi.useFakeTimers()
    const runTransaction = vi.fn(() => Promise.reject(new IdentityTransactionConflictError()))
    const result = createAuthenticationAdmissionHandoff(input, { runTransaction })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({ status: "restart", reason: "conflict" })
    expect(runTransaction).toHaveBeenCalledTimes(3)
  })
})
