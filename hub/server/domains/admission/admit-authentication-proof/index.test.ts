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
    requiresProviderAssignmentEvidence: false,
    sessionDigest: "a".repeat(64),
    sessionId: randomUUID(),
    sessionLifetimeSeconds: 3_600,
  }
}

function repositories(overrides: Partial<AdmissionRepositories> = {}) {
  const membershipId = randomUUID()
  return {
    claimProviderEvidence: vi.fn().mockResolvedValue("created"),
    createMembership: vi.fn().mockResolvedValue(undefined),
    createProviderAssignment: vi.fn().mockResolvedValue(true),
    createBootstrapAssignment: vi.fn().mockResolvedValue("created"),
    createHubSession: vi.fn().mockResolvedValue({ expiresAt: new Date("2030-01-01") }),
    createOrRestoreMembership: vi.fn().mockResolvedValue({
      id: membershipId,
      transition: "created",
    }),
    createSecurityAudit: vi.fn().mockResolvedValue(undefined),
    endProviderAssignment: vi.fn().mockResolvedValue(undefined),
    endOpenHubSessionsForMembership: vi.fn().mockResolvedValue([]),
    lockActiveAssignments: vi
      .fn()
      .mockResolvedValue([{ id: "assignment-id", role: "ADMINISTRATOR", source: "BOOTSTRAP" }]),
    lockActiveProviderAssignment: vi.fn().mockResolvedValue(null),
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
    lockProvider: vi.fn().mockResolvedValue({
      enabled: true,
      selectedRevisionId: "revision-id",
    }),
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
    ).resolves.toEqual({ expiresAt, role: "ADMINISTRATOR" })

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
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "new-revision",
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
    ).resolves.toEqual({
      expiresAt: new Date("2030-01-01"),
      role: "ADMINISTRATOR",
    })

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
    ).resolves.toEqual({
      expiresAt: new Date("2030-01-01"),
      role: "ADMINISTRATOR",
    })

    expect(getBootstrapSecretDigest).not.toHaveBeenCalled()
    expect(records.createOrRestoreMembership).not.toHaveBeenCalled()
    expect(records.createBootstrapAssignment).not.toHaveBeenCalled()
    expect(records.lockMembership).toHaveBeenCalledOnce()
    expect(records.lockActiveAssignments).toHaveBeenCalledOnce()
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

  it("ends and audits existing member sessions before first bootstrap elevation", async () => {
    const order: string[] = []
    const createSecurityAudit = vi
      .fn<AdmissionRepositories["createSecurityAudit"]>()
      .mockImplementation((event) => {
        order.push(event.type)
        return Promise.resolve()
      })
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("created"),
      createHubSession: vi.fn().mockImplementation(() => {
        order.push("create replacement")
        return Promise.resolve({ expiresAt: new Date("2030-01-01") })
      }),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "unchanged",
      }),
      createSecurityAudit,
      endOpenHubSessionsForMembership: vi.fn().mockImplementation(() => {
        order.push("end old")
        return Promise.resolve([{ id: "member-session" }])
      }),
    })

    await admitAuthenticationProof(input(), {
      createId: randomUUID,
      getBootstrapSecretDigest: () => bootstrapSecretDigest,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(order.indexOf("end old")).toBeGreaterThan(order.indexOf("membership_assignment_created"))
    expect(order.indexOf("session_ended")).toBeGreaterThan(order.indexOf("end old"))
    expect(order.indexOf("create replacement")).toBeGreaterThan(order.indexOf("session_ended"))
    expect(createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        membershipId: "membership-id",
        sessionId: "member-session",
        type: "session_ended",
      }),
    )
  })

  it("does not end sessions for a brand-new bootstrap membership", async () => {
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("created"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        transition: "created",
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
  })

  it("does not end sessions when active bootstrap authority is unchanged", async () => {
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("unchanged"),
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

    expect(endOpenHubSessionsForMembership).not.toHaveBeenCalled()
  })

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

  it("creates a provider assignment for exact Entra role evidence", async () => {
    const createProviderAssignment = vi.fn().mockResolvedValue(true)
    const records = repositories({
      createProviderAssignment,
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        lifecycle: "ACTIVE",
      }),
      lockActiveAssignments: vi.fn().mockResolvedValue([
        {
          id: "provider-assignment",
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      ]),
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
    })
    const request = {
      ...input(),
      providerKey: "entra",
      requiresProviderAssignmentEvidence: true,
      providerAssignment: {
        assignmentSubject: "11111111-1111-4111-8111-111111111111",
        issuedAt: new Date("2026-11-04T20:00:00Z"),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        role: "MEMBER" as const,
      },
    }

    await expect(
      admitAuthenticationProof(request, {
        createId: randomUUID,
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit: vi.fn(),
      }),
    ).resolves.toMatchObject({ role: "MEMBER" })
    expect(createProviderAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalIdentityId: request.proof.externalIdentityId,
        providerAssignmentSubject: "11111111-1111-4111-8111-111111111111",
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        role: "MEMBER",
      }),
    )
  })

  it("revokes provider authority and ends sessions when role evidence is lost", async () => {
    const endProviderAssignment = vi.fn().mockResolvedValue(undefined)
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([{ id: "open-session" }])
    const records = repositories({
      endProviderAssignment,
      endOpenHubSessionsForMembership,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        lifecycle: "ACTIVE",
      }),
      lockActiveProviderAssignment: vi.fn().mockResolvedValue({
        id: "provider-assignment-id",
        providerAssignmentSubject: "11111111-1111-4111-8111-111111111111",
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        role: "MEMBER",
      }),
      lockActiveAssignments: vi.fn().mockResolvedValue([]),
    })

    await expect(
      admitAuthenticationProof(
        {
          ...input(),
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          providerAssignment: {
            assignmentSubject: null,
            issuedAt: new Date("2026-11-04T20:00:00Z"),
            providerRevisionId: "00000000-0000-4000-8000-000000000099",
            role: null,
          },
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => bootstrapSecretDigest,
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ reason: "authority_missing" })
    expect(endProviderAssignment).toHaveBeenCalledWith({
      id: "provider-assignment-id",
      lifecycle: "REVOKED",
    })
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith("membership-id")
  })

  it("updates provider authority for a suspended membership without restoring it", async () => {
    const createProviderAssignment = vi.fn().mockResolvedValue(true)
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([{ id: "open-session" }])
    const request = {
      ...input(),
      providerKey: "entra",
      requiresProviderAssignmentEvidence: true,
      providerAssignment: {
        assignmentSubject: "11111111-1111-4111-8111-111111111111",
        issuedAt: new Date("2026-11-04T20:00:00Z"),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        role: "ADMINISTRATOR" as const,
      },
    }
    const records = repositories({
      createProviderAssignment,
      endOpenHubSessionsForMembership,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "membership-id",
        lifecycle: "SUSPENDED",
      }),
    })

    await expect(
      admitAuthenticationProof(request, {
        createId: randomUUID,
        getBootstrapSecretDigest: () => bootstrapSecretDigest,
        runTransaction: (operation) => operation(records),
        writeAudit: vi.fn(),
      }),
    ).rejects.toMatchObject({ reason: "membership_inactive" })
    expect(createProviderAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        externalIdentityId: request.proof.externalIdentityId,
        role: "ADMINISTRATOR",
      }),
    )
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith("membership-id")
  })

  it("supersedes a revision-only provider assignment and ends open sessions", async () => {
    const endProviderAssignment = vi.fn().mockResolvedValue(undefined)
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([])
    const records = repositories({
      endProviderAssignment,
      endOpenHubSessionsForMembership,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000077",
        lifecycle: "ACTIVE",
      }),
      lockActiveProviderAssignment: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000088",
        providerAssignmentSubject: "11111111-1111-4111-8111-111111111111",
        providerRevisionId: "00000000-0000-4000-8000-000000000098",
        role: "MEMBER",
      }),
      lockActiveAssignments: vi.fn().mockResolvedValue([
        {
          id: "replacement-assignment",
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      ]),
    })

    await expect(
      admitAuthenticationProof(
        {
          ...input(),
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          providerAssignment: {
            assignmentSubject: "11111111-1111-4111-8111-111111111111",
            issuedAt: new Date("2026-11-04T20:00:00Z"),
            providerRevisionId: "00000000-0000-4000-8000-000000000099",
            role: "MEMBER",
          },
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => bootstrapSecretDigest,
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({ role: "MEMBER" })
    expect(endProviderAssignment).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000088",
      lifecycle: "SUPERSEDED",
    })
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000077",
    )
  })

  it("denies Entra when provider assignment evidence is missing", async () => {
    const createHubSession = vi.fn()
    const writeAudit = vi.fn()
    const records = repositories({
      createHubSession,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
    })

    await expect(
      admitAuthenticationProof(
        {
          ...input(),
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => bootstrapSecretDigest,
          runTransaction: (operation) => operation(records),
          writeAudit,
        },
      ),
    ).rejects.toMatchObject({ reason: "provider_evidence_missing" })
    expect(createHubSession).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "provider_evidence_missing",
        type: "admission_denied",
      }),
    )
  })

  it("applies Entra role-loss evidence after administrator bootstrap enrollment", async () => {
    const endProviderAssignment = vi.fn().mockResolvedValue(undefined)
    const endOpenHubSessionsForMembership = vi.fn().mockResolvedValue([{ id: "old-session" }])
    const records = repositories({
      createBootstrapAssignment: vi.fn().mockResolvedValue("unchanged"),
      createOrRestoreMembership: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000077",
        transition: "unchanged",
      }),
      endProviderAssignment,
      endOpenHubSessionsForMembership,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        bootstrapSecretDigest,
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "ADMIN_ENROLLMENT",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000077",
        lifecycle: "ACTIVE",
      }),
      lockActiveProviderAssignment: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000088",
        providerAssignmentSubject: "11111111-1111-4111-8111-111111111111",
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        role: "MEMBER",
      }),
      lockActiveAssignments: vi.fn().mockResolvedValue([
        {
          id: "bootstrap-assignment",
          role: "ADMINISTRATOR",
          source: "BOOTSTRAP",
        },
      ]),
    })

    await expect(
      admitAuthenticationProof(
        {
          ...input(),
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          providerAssignment: {
            assignmentSubject: null,
            issuedAt: new Date("2026-11-04T20:00:00Z"),
            providerRevisionId: "00000000-0000-4000-8000-000000000099",
            role: null,
          },
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => bootstrapSecretDigest,
          runTransaction: (operation) => operation(records),
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({ role: "ADMINISTRATOR" })
    expect(endProviderAssignment).toHaveBeenCalledWith({
      id: "00000000-0000-4000-8000-000000000088",
      lifecycle: "REVOKED",
    })
    expect(endOpenHubSessionsForMembership).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000077",
    )
  })

  it("retries when provider assignment creation loses an active-version race", async () => {
    const createProviderAssignment = vi
      .fn<AdmissionRepositories["createProviderAssignment"]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const records = repositories({
      createProviderAssignment,
      getExternalIdentity: vi.fn().mockResolvedValue({
        provider: "entra",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
      lockAttempt: vi.fn().mockResolvedValue({
        consumedAt: new Date(),
        providerRevisionId: "00000000-0000-4000-8000-000000000099",
        purpose: "SIGN_IN",
      }),
      lockProvider: vi.fn().mockResolvedValue({
        enabled: true,
        selectedRevisionId: "00000000-0000-4000-8000-000000000099",
      }),
      lockMembership: vi.fn().mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000077",
        lifecycle: "ACTIVE",
      }),
      lockActiveAssignments: vi.fn().mockResolvedValue([
        {
          id: "provider-assignment",
          role: "MEMBER",
          source: "AUTHENTICATION_PROVIDER",
        },
      ]),
    })
    let transactionCalls = 0

    await expect(
      admitAuthenticationProof(
        {
          ...input(),
          providerKey: "entra",
          requiresProviderAssignmentEvidence: true,
          providerAssignment: {
            assignmentSubject: "11111111-1111-4111-8111-111111111111",
            issuedAt: new Date("2026-11-04T20:00:00Z"),
            providerRevisionId: "00000000-0000-4000-8000-000000000099",
            role: "MEMBER",
          },
        },
        {
          createId: randomUUID,
          getBootstrapSecretDigest: () => bootstrapSecretDigest,
          runTransaction: (operation) => {
            transactionCalls += 1
            return operation(records)
          },
          writeAudit: vi.fn(),
        },
      ),
    ).resolves.toMatchObject({ role: "MEMBER" })
    expect(transactionCalls).toBe(2)
    expect(createProviderAssignment).toHaveBeenCalledTimes(2)
  })
})
