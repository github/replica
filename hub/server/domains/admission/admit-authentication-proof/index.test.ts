import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { AdmissionPersistenceError, AdmissionTransactionConflictError } from "../errors"
import type { AdmissionDeniedError } from "../errors"
import type { AdmissionRepositories } from "../run-admission-transaction/types"
import { admitAuthenticationProof } from "."

function input() {
  return {
    proof: {
      authorizationAttemptId: randomUUID(),
      externalIdentityId: randomUUID(),
    },
    providerKey: "github",
    sessionDigest: "a".repeat(64),
    sessionId: randomUUID(),
    sessionLifetimeSeconds: 3_600,
  }
}

function repositories(overrides: Partial<AdmissionRepositories> = {}) {
  const membershipId = randomUUID()
  return {
    createBootstrapAssignment: vi.fn().mockResolvedValue("created"),
    createHubSession: vi.fn().mockResolvedValue({ expiresAt: new Date("2030-01-01") }),
    createOrRestoreMembership: vi.fn().mockResolvedValue({
      id: membershipId,
      transition: "created",
    }),
    createSecurityAudit: vi.fn().mockResolvedValue(undefined),
    lockActiveAssignment: vi.fn().mockResolvedValue({ role: "ADMINISTRATOR" }),
    lockAttempt: vi.fn().mockResolvedValue({
      consumedAt: new Date(),
      providerRevisionId: "revision-id",
      purpose: "ADMIN_ENROLLMENT",
    }),
    getExternalIdentity: vi.fn().mockResolvedValue({
      provider: "github",
      userId: "user-id",
    }),
    lockMembership: vi.fn().mockResolvedValue({
      id: membershipId,
      lifecycle: "ACTIVE",
    }),
    lockProvider: vi.fn().mockResolvedValue({ selectedRevisionId: "revision-id" }),
    lockRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
    ...overrides,
  } satisfies AdmissionRepositories
}

describe("admitAuthenticationProof()", () => {
  it("retries the complete transaction with the kernel policy before succeeding", async () => {
    const expiresAt = new Date("2030-01-01")
    const createHubSession = vi
      .fn<AdmissionRepositories["createHubSession"]>()
      .mockResolvedValue({ expiresAt })
    const records = repositories({ createHubSession })
    const request = input()
    let transactionCalls = 0
    async function runTransaction<Result>(
      operation: (repositories: AdmissionRepositories) => Promise<Result>,
    ) {
      transactionCalls += 1
      if (transactionCalls < 3) throw new AdmissionTransactionConflictError()
      return operation(records)
    }
    const writeAudit = vi.fn()

    await expect(
      admitAuthenticationProof(request, {
        createId: randomUUID,
        runTransaction,
        writeAudit,
      }),
    ).resolves.toEqual({ expiresAt })

    expect(transactionCalls).toBe(3)
    expect(writeAudit).not.toHaveBeenCalled()
    expect(createHubSession).toHaveBeenCalledWith(
      expect.objectContaining({
        digest: request.sessionDigest,
        id: request.sessionId,
        lifetimeSeconds: request.sessionLifetimeSeconds,
        revocationRevision: 0,
      }),
    )
  })

  it("writes one terminal failure audit after retry exhaustion", async () => {
    const runTransaction = vi.fn().mockRejectedValue(new AdmissionTransactionConflictError())
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const request = input()

    await expect(
      admitAuthenticationProof(request, {
        createId: randomUUID,
        runTransaction,
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(AdmissionPersistenceError)

    expect(runTransaction).toHaveBeenCalledTimes(3)
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "admission_failed",
        externalIdentityId: request.proof.externalIdentityId,
        reason: "retry_exhausted",
      }),
    )
  })

  it("denies a proof when the selected provider revision changed before admission", async () => {
    const createHubSession = vi.fn().mockResolvedValue({ expiresAt: new Date("2030-01-01") })
    const records = repositories({
      createHubSession,
      lockProvider: vi.fn().mockResolvedValue({ selectedRevisionId: "new-revision" }),
    })

    const writeAudit = vi.fn().mockResolvedValue(undefined)

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toMatchObject<Partial<AdmissionDeniedError>>({
      reason: "configuration_changed",
    })

    expect(createHubSession).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "admission_denied",
        reason: "configuration_changed",
      }),
    )
  })

  it("audits membership restoration without duplicating an unchanged assignment audit", async () => {
    const createSecurityAudit = vi
      .fn<AdmissionRepositories["createSecurityAudit"]>()
      .mockResolvedValue(undefined)
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("unchanged"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "restored",
      }),
      createSecurityAudit,
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "membership_restored",
        membershipId: "membership-id",
      }),
    )
    expect(createSecurityAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "membership_assignment_restored" }),
    )
  })

  it("does not audit an unchanged active membership lifecycle", async () => {
    const createSecurityAudit = vi
      .fn<AdmissionRepositories["createSecurityAudit"]>()
      .mockResolvedValue(undefined)
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("unchanged"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "unchanged",
      }),
      createSecurityAudit,
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(createSecurityAudit.mock.calls.map(([event]) => event.type)).not.toEqual(
      expect.arrayContaining(["membership_created", "membership_restored"]),
    )
  })

  it("records a terminal failure only after a success-audit rollback", async () => {
    const committed: string[] = []
    const records = repositories({
      createHubSession: vi.fn().mockImplementation(() => {
        committed.push("staged-session")
        return Promise.resolve({ expiresAt: new Date("2030-01-01") })
      }),
      createSecurityAudit: vi.fn().mockRejectedValue(new Error("audit unavailable")),
    })
    const writeAudit = vi.fn().mockResolvedValue(undefined)

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        runTransaction: async (operation) => {
          try {
            return await operation(records)
          } finally {
            committed.length = 0
          }
        },
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(AdmissionPersistenceError)

    expect(committed).toEqual([])
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "admission_failed",
        reason: "transaction_error",
      }),
    )
  })
})
