import { randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import { AdmissionPersistenceError, AdmissionTransactionConflictError } from "../errors"
import type { AdmissionDeniedError } from "../errors"
import type { AdmissionRepositories } from "../run-admission-transaction/types"
import { admitAuthenticationProof } from "."

const bootstrapSecretDigest = "f".repeat(64)

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
    endOpenHubSessionsForMembership: vi.fn().mockResolvedValue([]),
    lockActiveAssignment: vi.fn().mockResolvedValue(true),
    lockAttempt: vi.fn().mockResolvedValue({
      bootstrapSecretDigest,
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
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
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
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
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
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
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

  it("admits enrollment when the bootstrap secret digest is unchanged", async () => {
    const records = repositories()
    const getBootstrapSecretDigest = vi.fn().mockReturnValue(bootstrapSecretDigest)

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        getBootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit: vi.fn(),
      }),
    ).resolves.toEqual({ expiresAt: new Date("2030-01-01") })

    expect(getBootstrapSecretDigest).toHaveBeenCalledOnce()
    expect(records.createOrRestoreMembership).toHaveBeenCalledOnce()
    expect(records.createBootstrapAssignment).toHaveBeenCalledOnce()
    expect(records.createHubSession).toHaveBeenCalledOnce()
  })

  it.each([
    ["missing", null],
    ["rotated", "e".repeat(64)],
  ])("denies enrollment when its bootstrap secret digest is %s", async (_case, storedDigest) => {
    const records = repositories({
      lockAttempt: vi.fn().mockResolvedValue({
        bootstrapSecretDigest: storedDigest,
        consumedAt: new Date(),
        providerRevisionId: "revision-id",
        purpose: "ADMIN_ENROLLMENT",
      }),
    })
    const writeAudit = vi.fn().mockResolvedValue(undefined)

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toMatchObject<Partial<AdmissionDeniedError>>({
      reason: "configuration_changed",
    })

    expect(records.createOrRestoreMembership).not.toHaveBeenCalled()
    expect(records.createBootstrapAssignment).not.toHaveBeenCalled()
    expect(records.createHubSession).not.toHaveBeenCalled()
    expect(records.createSecurityAudit).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "admission_denied",
        reason: "configuration_changed",
      }),
    )
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain(bootstrapSecretDigest)
    if (storedDigest) expect(JSON.stringify(writeAudit.mock.calls)).not.toContain(storedDigest)
  })

  it("admits normal sign-in without a bootstrap secret digest", async () => {
    const getBootstrapSecretDigest = vi.fn()
    const records = repositories({
      lockAttempt: vi.fn().mockResolvedValue({
        bootstrapSecretDigest: null,
        consumedAt: new Date(),
        providerRevisionId: "revision-id",
        purpose: "SIGN_IN",
      }),
    })

    await expect(
      admitAuthenticationProof(input(), {
        createId: randomUUID,
        getBootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit: vi.fn(),
      }),
    ).resolves.toEqual({ expiresAt: new Date("2030-01-01") })

    expect(getBootstrapSecretDigest).not.toHaveBeenCalled()
    expect(records.createOrRestoreMembership).not.toHaveBeenCalled()
    expect(records.createBootstrapAssignment).not.toHaveBeenCalled()
    expect(records.lockMembership).toHaveBeenCalledOnce()
    expect(records.lockActiveAssignment).toHaveBeenCalledOnce()
    expect(records.createHubSession).toHaveBeenCalledOnce()
  })

  it("ends open sessions when enrollment restores only the membership", async () => {
    const createSecurityAudit = vi
      .fn<AdmissionRepositories["createSecurityAudit"]>()
      .mockResolvedValue(undefined)
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([{ id: "old-session-id" }])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("unchanged"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "restored",
      }),
      createSecurityAudit,
      endOpenHubSessionsForMembership,
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(endOpenHubSessionsForMembership).toHaveBeenCalledOnce()
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith("membership-id")
    expect(createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "membership_restored",
        membershipId: "membership-id",
      }),
    )
    expect(createSecurityAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "membership_assignment_restored" }),
    )
    expect(createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session_ended",
        sessionId: "old-session-id",
        membershipId: "membership-id",
      }),
    )
  })

  it("ends open sessions when enrollment restores only the assignment", async () => {
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("restored"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "unchanged",
      }),
      endOpenHubSessionsForMembership,
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(endOpenHubSessionsForMembership).toHaveBeenCalledOnce()
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith("membership-id")
  })

  it("ends sessions once and audits each ended session when both authorities are restored", async () => {
    const createSecurityAudit = vi
      .fn<AdmissionRepositories["createSecurityAudit"]>()
      .mockResolvedValue(undefined)
    const endOpenHubSessionsForMembership = vi
      .fn()
      .mockResolvedValue([{ id: "old-session-1" }, { id: "old-session-2" }])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("restored"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "restored",
      }),
      createSecurityAudit,
      endOpenHubSessionsForMembership,
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(endOpenHubSessionsForMembership).toHaveBeenCalledOnce()
    expect(
      createSecurityAudit.mock.calls
        .map(([event]) => event)
        .filter((event) => event.type === "session_ended"),
    ).toEqual([
      expect.objectContaining({ sessionId: "old-session-1", membershipId: "membership-id" }),
      expect.objectContaining({ sessionId: "old-session-2", membershipId: "membership-id" }),
    ])
  })

  it.each([
    ["created", "created"],
    ["unchanged", "unchanged"],
  ] as const)(
    "does not end sessions when enrollment leaves authority %s and assignment %s",
    async (membershipTransition, assignmentTransition) => {
      const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([])
      const records = repositories({
        createBootstrapAssignment: vi.fn().mockResolvedValue(assignmentTransition),
        createOrRestoreMembership: vi.fn().mockResolvedValue({
          id: "membership-id",
          transition: membershipTransition,
        }),
        endOpenHubSessionsForMembership,
      })

      await admitAuthenticationProof(input(), {
        createId: randomUUID,
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit: vi.fn(),
      })

      expect(endOpenHubSessionsForMembership).not.toHaveBeenCalled()
    },
  )

  it("creates the replacement session after ending restored authority sessions", async () => {
    const order: string[] = []
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("restored"),
      createHubSession: vi.fn().mockImplementation(() => {
        order.push("create replacement")
        return Promise.resolve({ expiresAt: new Date("2030-01-01") })
      }),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "restored",
      }),
      endOpenHubSessionsForMembership: vi.fn().mockImplementation(() => {
        order.push("end old")
        return Promise.resolve([])
      }),
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(order).toEqual(["end old", "create replacement"])
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
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
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
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
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
