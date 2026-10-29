import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { Prisma } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { createAuthenticationProviderRevision } from "../../../repositories/authentication-providers/create-authentication-provider-revision"
import { createAuthenticationProvider } from "../../../repositories/authentication-providers/create-authentication-provider"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider"
import { selectAuthenticationProviderRevision } from "../../../repositories/authentication-providers/select-authentication-provider-revision"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit"
import { createValidatedProviderRevision } from "../create-validated-provider-revision"
import {
  IdentityTransactionConflictError,
  ProviderRevisionConflictError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionRollbackError,
} from "../errors"
import { runProviderRevisionTransaction } from "../run-provider-revision-transaction"
import type {
  ProviderRevisionRepositories,
  ProviderRevisionTransaction,
} from "../run-provider-revision-transaction/types"
import { persistValidatedProviderRevision } from "."

function dependencies() {
  return {
    createId: randomUUID,
    runTransaction: <Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ) => runProviderRevisionTransaction(prisma, operation),
    writeAudit: (input: Parameters<typeof createSecurityAudit>[1]) =>
      createSecurityAudit(prisma, input),
  }
}

function revision(revisionNumber: number, audience = `hub-${revisionNumber}`) {
  return createValidatedProviderRevision({
    providerKey: "workforce",
    revision: revisionNumber,
    settings: { issuer: "https://id.example.test", audience },
  })
}

function controlledConcurrentTransaction(): ProviderRevisionTransaction {
  let arrivals = 0
  let release: (() => void) | undefined
  const overlap = new Promise<void>((resolve) => {
    release = resolve
  })

  return async (operation) => {
    try {
      return await prisma.$transaction(
        (transaction) =>
          operation({
            createAuthenticationProvider: (input) =>
              createAuthenticationProvider(transaction, input),
            createAuthenticationProviderRevision: (input) =>
              createAuthenticationProviderRevision(transaction, input),
            createSecurityAudit: (input) => createSecurityAudit(transaction, input),
            findAuthenticationProvider: async (key) => {
              const provider = await findAuthenticationProvider(transaction, key)
              arrivals += 1
              if (arrivals === 2) release?.()
              await overlap
              return provider
            },
            selectAuthenticationProviderRevision: (input) =>
              selectAuthenticationProviderRevision(transaction, input),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2034"].includes(error.code)
      ) {
        throw new IdentityTransactionConflictError({ cause: error })
      }
      throw error
    }
  }
}

describe("persistValidatedProviderRevision()", () => {
  it("selects validated revisions atomically with a success audit", async () => {
    const first = await persistValidatedProviderRevision(revision(1), dependencies())
    const second = await persistValidatedProviderRevision(revision(2), dependencies())

    expect(first).toMatchObject({ status: "selected", revision: 1 })
    expect(second).toMatchObject({
      status: "selected",
      providerId: first.providerId,
      revision: 2,
    })
    await expect(
      prisma.authenticationProvider.findUnique({
        where: { id: first.providerId },
        include: { selectedRevision: true, revisions: { orderBy: { revision: "asc" } } },
      }),
    ).resolves.toMatchObject({
      selectedRevision: { id: second.revisionId, revision: 2 },
      revisions: [{ revision: 1 }, { revision: 2 }],
    })
    await expect(prisma.securityAudit.count()).resolves.toBe(2)
  })

  it("returns an unchanged selected revision only for the same digest", async () => {
    const first = await persistValidatedProviderRevision(revision(1), dependencies())
    const unchanged = await persistValidatedProviderRevision(revision(1), dependencies())

    expect(unchanged).toEqual({ ...first, status: "unchanged" })
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count()).resolves.toBe(1)
  })

  it("rejects rollback, same-revision drift, and revision gaps after rollback", async () => {
    await persistValidatedProviderRevision(revision(1), dependencies())
    await persistValidatedProviderRevision(revision(2), dependencies())

    await expect(
      persistValidatedProviderRevision(revision(1), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionRollbackError)
    await expect(
      persistValidatedProviderRevision(revision(2, "changed"), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionDriftError)
    await expect(
      persistValidatedProviderRevision(revision(4), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionGapError)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    const deniedAudits = await prisma.securityAudit.findMany({
      where: { outcome: "DENIED" },
      orderBy: { createdAt: "asc" },
    })
    expect(deniedAudits.map(({ context }) => context)).toEqual([
      { provider: "workforce", revision: 1, reason: "rollback" },
      { provider: "workforce", revision: 2, reason: "same_revision_drift" },
      { provider: "workforce", revision: 4, reason: "revision_gap" },
    ])
  })

  it("rolls back a partially written revision before recording its failure audit", async () => {
    await persistValidatedProviderRevision(revision(1), dependencies())
    const base = dependencies()
    async function runTransaction<Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ): Promise<Result> {
      return prisma.$transaction(
        (transaction) =>
          operation({
            createAuthenticationProvider: (input) =>
              createAuthenticationProvider(transaction, input),
            createAuthenticationProviderRevision: (input) =>
              createAuthenticationProviderRevision(transaction, input),
            createSecurityAudit: (input) => createSecurityAudit(transaction, input),
            findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
            selectAuthenticationProviderRevision: () =>
              Promise.reject(new Error("injected selection failure")),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    }

    await expect(
      persistValidatedProviderRevision(revision(2), { ...base, runTransaction }),
    ).rejects.toThrow("injected selection failure")
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(1)
    await expect(
      prisma.authenticationProvider.findUnique({
        where: { key: "workforce" },
        include: { selectedRevision: true },
      }),
    ).resolves.toMatchObject({ selectedRevision: { revision: 1 } })
    const failureAudit = await prisma.securityAudit.findFirst({
      where: { outcome: "FAILURE" },
    })
    expect(failureAudit?.action).toBe("identity.provider_revision.persist_failed")
    expect(failureAudit?.context).toEqual({
      provider: "workforce",
      revision: 2,
      reason: "transaction_error",
    })
  })

  it("overlaps competing next revisions and commits exactly one complete update", async () => {
    await persistValidatedProviderRevision(revision(1), dependencies())
    const runTransaction = controlledConcurrentTransaction()
    const first = persistValidatedProviderRevision(revision(2, "first"), {
      ...dependencies(),
      runTransaction,
    })
    const second = persistValidatedProviderRevision(revision(2, "second"), {
      ...dependencies(),
      runTransaction,
    })

    const results = await Promise.allSettled([first, second])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof ProviderRevisionConflictError,
      ),
    ).toHaveLength(1)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    const audits = await prisma.securityAudit.groupBy({
      by: ["outcome"],
      _count: { _all: true },
    })
    expect(Object.fromEntries(audits.map(({ outcome, _count }) => [outcome, _count._all]))).toEqual(
      {
        SUCCESS: 2,
        FAILURE: 1,
      },
    )
  })
})
