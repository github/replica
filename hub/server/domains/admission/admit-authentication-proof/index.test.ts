import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  AdmissionDeniedError,
  AdmissionPersistenceError,
  AdmissionTransactionConflictError,
} from "../errors"
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

function repositories(overrides: Partial<AdmissionRepositories> = {}): AdmissionRepositories {
  const membershipId = randomUUID()
  return {
    createBootstrapAssignment: vi.fn().mockResolvedValue("created"),
    createHubSession: vi.fn().mockResolvedValue({ expiresAt: new Date("2030-01-01") }),
    createOrRestoreMembership: vi.fn().mockResolvedValue({ id: membershipId }),
    createSecurityAudit: vi.fn().mockResolvedValue(undefined),
    lockActiveAssignment: vi.fn().mockResolvedValue({ role: "ADMINISTRATOR" }),
    lockAttempt: vi.fn().mockResolvedValue({
      consumedAt: new Date(),
      providerRevisionId: "revision-id",
      purpose: "ADMIN_ENROLLMENT",
    }),
    lockExternalIdentity: vi.fn().mockResolvedValue({
      provider: "github",
      userId: "user-id",
    }),
    lockMembership: vi.fn().mockResolvedValue({
      id: membershipId,
      lifecycle: "ACTIVE",
    }),
    lockProvider: vi.fn().mockResolvedValue({ selectedRevisionId: "revision-id" }),
    lockRevocation: vi.fn().mockResolvedValue({ revision: 0 }),
    lockUser: vi.fn().mockResolvedValue({ id: "user-id" }),
    ...overrides,
  }
}

describe("admitAuthenticationProof()", () => {
  it("retries the complete transaction with the kernel policy before succeeding", async () => {
    const records = repositories()
    const runTransaction = vi
      .fn()
      .mockRejectedValueOnce(new AdmissionTransactionConflictError())
      .mockRejectedValueOnce(new AdmissionTransactionConflictError())
      .mockImplementation((operation) => operation(records))
    const writeAudit = vi.fn()

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        runTransaction,
        writeAudit,
      }),
    ).resolves.toMatchObject({ role: "administrator" })

    expect(runTransaction).toHaveBeenCalledTimes(3)
    expect(writeAudit).not.toHaveBeenCalled()
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

  it("fails closed when the authoritative user reread is missing", async () => {
    const records = repositories({ lockUser: vi.fn().mockResolvedValue(null) })
    const writeAudit = vi.fn().mockResolvedValue(undefined)
    const request = input()

    await expect(
      admitAuthenticationProof(request, {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toMatchObject<Partial<AdmissionDeniedError>>({
      reason: "identity_mismatch",
    })

    expect(records.createOrRestoreMembership).not.toHaveBeenCalled()
    expect(records.createHubSession).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "admission_denied",
        reason: "identity_mismatch",
      }),
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
