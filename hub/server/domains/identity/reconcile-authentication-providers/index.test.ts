import { createHash, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  IdentityTransactionConflictError,
  ProviderRevisionConflictError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionInvariantError,
  ProviderRevisionRollbackError,
  ProviderReactivationRevisionError,
} from "../errors"
import type { AuthenticationProviderReconciliationRepositories } from "../run-provider-revision-transaction/types"
import { reconcileAuthenticationProviders } from "."

function repositories(
  existing: Awaited<
    ReturnType<AuthenticationProviderReconciliationRepositories["lockAuthenticationProviders"]>
  >,
) {
  return {
    createAuthenticationProvider: vi.fn(),
    createAuthenticationProviderRevision: vi.fn(),
    createSecurityAudit: vi.fn(),
    disconnectCopilotConnectionWithoutEffectiveAdministrator: vi.fn().mockResolvedValue(null),
    disableAuthenticationProvider: vi.fn(),
    enableAuthenticationProvider: vi.fn(),
    findAuthenticationProvider: vi.fn(),
    incrementSessionRevocation: vi.fn(),
    lockAuthenticationProviders: vi.fn().mockResolvedValue(existing),
    selectAuthenticationProviderRevision: vi.fn(),
  } satisfies AuthenticationProviderReconciliationRepositories
}

function candidate(revision: number) {
  return {
    canonicalPublicConfiguration: '{"provider":"github"}',
    providerKey: "github",
    revision,
  }
}

describe("reconcileAuthenticationProviders()", () => {
  it.each([
    ["rollback", 2, 1, "rollback", ProviderRevisionRollbackError],
    ["gap", 1, 3, "revision_gap", ProviderRevisionGapError],
  ] as const)(
    "rejects a provider revision %s",
    async (_case, currentRevision, nextRevision, reason, error) => {
      const records = repositories([
        {
          configurationDigest: "a".repeat(64),
          enabled: true,
          id: randomUUID(),
          key: "github",
          revision: currentRevision,
          revisionId: randomUUID(),
        },
      ])
      const writeAudit = vi.fn()

      await expect(
        reconcileAuthenticationProviders([candidate(nextRevision)], {
          createId: randomUUID,
          runTransaction: (operation) => operation(records),
          writeAudit,
        }),
      ).rejects.toBeInstanceOf(error)
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          providerKey: "github",
          reason,
          revision: nextRevision,
          type: "provider_revision_denied",
        }),
      )
    },
  )

  it("requires a new provider to begin at revision one", async () => {
    const records = repositories([])
    const writeAudit = vi.fn()

    await expect(
      reconcileAuthenticationProviders([candidate(2)], {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(ProviderRevisionGapError)
    expect(records.createAuthenticationProvider).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: "github",
        reason: "revision_gap",
        revision: 2,
        type: "provider_revision_denied",
      }),
    )
  })

  it("rejects same-revision configuration drift without mutating provider state", async () => {
    const records = repositories([
      {
        configurationDigest: "a".repeat(64),
        enabled: true,
        id: randomUUID(),
        key: "github",
        revision: 1,
        revisionId: randomUUID(),
      },
    ])
    const writeAudit = vi.fn()

    await expect(
      reconcileAuthenticationProviders([candidate(1)], {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(ProviderRevisionDriftError)
    expect(records.createAuthenticationProviderRevision).not.toHaveBeenCalled()
    expect(records.selectAuthenticationProviderRevision).not.toHaveBeenCalled()
    expect(records.enableAuthenticationProvider).not.toHaveBeenCalled()
    expect(records.disableAuthenticationProvider).not.toHaveBeenCalled()
    expect(records.createSecurityAudit).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: "github",
        reason: "same_revision_drift",
        revision: 1,
        type: "provider_revision_denied",
      }),
    )
  })

  it("denies same-revision reactivation with typed audit evidence", async () => {
    const records = repositories([
      {
        configurationDigest: createHash("sha256")
          .update(candidate(1).canonicalPublicConfiguration)
          .digest("hex"),
        enabled: false,
        id: randomUUID(),
        key: "github",
        revision: 1,
        revisionId: randomUUID(),
      },
    ])
    const writeAudit = vi.fn()

    await expect(
      reconcileAuthenticationProviders([candidate(1)], {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(ProviderReactivationRevisionError)

    expect(records.createAuthenticationProviderRevision).not.toHaveBeenCalled()
    expect(records.enableAuthenticationProvider).not.toHaveBeenCalled()
    expect(records.createSecurityAudit).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKey: "github",
        reason: "reactivation_requires_revision",
        revision: 1,
        type: "provider_revision_denied",
      }),
    )
  })

  it("fails provider removal when global revocation authority is missing", async () => {
    const records = repositories([
      {
        configurationDigest: "a".repeat(64),
        enabled: true,
        id: randomUUID(),
        key: "github",
        revision: 1,
        revisionId: randomUUID(),
      },
    ])
    records.incrementSessionRevocation.mockResolvedValue(null)
    const writeAudit = vi.fn()

    await expect(
      reconcileAuthenticationProviders([], {
        createId: randomUUID,
        runTransaction: (operation) => operation(records),
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(ProviderRevisionInvariantError)
    expect(records.disableAuthenticationProvider).not.toHaveBeenCalled()
    expect(records.createSecurityAudit).not.toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKeys: [],
        reason: "transaction_error",
        type: "authentication_providers_reconcile_failed",
      }),
    )
  })

  it("disconnects Copilot when provider removal ends the connector's final administrator source", async () => {
    const records = repositories([
      {
        configurationDigest: "a".repeat(64),
        enabled: true,
        id: randomUUID(),
        key: "github",
        revision: 1,
        revisionId: randomUUID(),
      },
    ])
    const membershipId = randomUUID()
    records.incrementSessionRevocation.mockResolvedValue({ revision: 1 })
    records.disconnectCopilotConnectionWithoutEffectiveAdministrator.mockResolvedValue({
      membershipId,
    })

    await reconcileAuthenticationProviders([], {
      createId: randomUUID,
      runTransaction: (operation) => operation(records),
      writeAudit: vi.fn(),
    })

    expect(records.disconnectCopilotConnectionWithoutEffectiveAdministrator).toHaveBeenCalledOnce()
    expect(records.createSecurityAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorMembershipId: null,
        connectorMembershipId: membershipId,
        operation: "disconnect",
        outcome: "success",
        reason: "connector_role_removed",
        type: "copilot_connection",
      }),
    )
  })

  it("writes one terminal retry-exhaustion audit after the bounded transaction policy", async () => {
    const writeAudit = vi.fn()
    const runTransaction = vi.fn().mockRejectedValue(new IdentityTransactionConflictError())

    await expect(
      reconcileAuthenticationProviders([candidate(1)], {
        createId: randomUUID,
        runTransaction,
        writeAudit,
      }),
    ).rejects.toBeInstanceOf(ProviderRevisionConflictError)
    expect(runTransaction).toHaveBeenCalledTimes(3)
    expect(writeAudit).toHaveBeenCalledOnce()
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        providerKeys: ["github"],
        reason: "retry_exhausted",
        type: "authentication_providers_reconcile_failed",
      }),
    )
  })
})
