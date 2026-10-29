import { createHash, randomUUID } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { Prisma } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { createAuthenticationProviderRevision } from "../../../repositories/authentication-providers/create-authentication-provider-revision"
import { createAuthenticationProvider } from "../../../repositories/authentication-providers/create-authentication-provider"
import { findAuthenticationProvider } from "../../../repositories/authentication-providers/find-authentication-provider"
import { selectAuthenticationProviderRevision } from "../../../repositories/authentication-providers/select-authentication-provider-revision"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit"
import {
  IdentityTransactionConflictError,
  ProviderRevisionDriftError,
  ProviderRevisionGapError,
  ProviderRevisionRollbackError,
} from "../errors"
import { runProviderRevisionTransaction } from "../run-provider-revision-transaction"
import type {
  ProviderRevisionRepositories,
  ProviderRevisionTransaction,
} from "../run-provider-revision-transaction/types"
import { validateAndPersistProviderRevision } from "."

interface ConfigurationCandidate {
  audience: string
}

const candidateSchema = z.object({ audience: z.string().min(1) }).strict()

function validateConfiguration(candidate: ConfigurationCandidate) {
  const parsed = candidateSchema.parse(candidate)
  return Promise.resolve({
    canonicalPublicConfiguration: JSON.stringify({ audience: parsed.audience }),
  })
}

function dependencies(
  validator: (candidate: ConfigurationCandidate) => Promise<{
    canonicalPublicConfiguration: string
  }> = validateConfiguration,
) {
  return {
    createId: randomUUID,
    retry: {
      baseDelayMs: 0,
      maxAttempts: 3,
      maxDelayMs: 0,
      sleep: () => Promise.resolve(),
    },
    runTransaction: <Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ) => runProviderRevisionTransaction(prisma, operation),
    validateConfiguration: validator,
    writeAudit: (input: Parameters<typeof createSecurityAudit>[1]) =>
      createSecurityAudit(prisma, input),
  }
}

function input(revision: number, audience = `hub-${revision}`) {
  return {
    providerKey: "workforce",
    revision,
    configuration: { audience },
  }
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
            createAuthenticationProvider: (value) =>
              createAuthenticationProvider(transaction, value),
            createAuthenticationProviderRevision: (value) =>
              createAuthenticationProviderRevision(transaction, value),
            createSecurityAudit: (value) => createSecurityAudit(transaction, value),
            findAuthenticationProvider: async (key) => {
              const provider = await findAuthenticationProvider(transaction, key)
              if (arrivals < 2) {
                arrivals += 1
                if (arrivals === 2) release?.()
                await overlap
              }
              return provider
            },
            selectAuthenticationProviderRevision: (value) =>
              selectAuthenticationProviderRevision(transaction, value),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        throw new IdentityTransactionConflictError({ cause: error })
      }
      throw error
    }
  }
}

describe("validateAndPersistProviderRevision()", () => {
  it("validates before the transaction and persists only the kernel-computed digest", async () => {
    const order: string[] = []
    const validator = vi.fn(async (candidate: ConfigurationCandidate) => {
      order.push("validate")
      return validateConfiguration(candidate)
    })
    const base = dependencies(validator)
    async function runTransaction<Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ) {
      order.push("transaction")
      return base.runTransaction(operation)
    }

    const result = await validateAndPersistProviderRevision(input(1), {
      ...base,
      runTransaction,
    })

    expect(order).toEqual(["validate", "transaction"])
    expect(validator).toHaveBeenCalledOnce()
    const revision = await prisma.authenticationProviderRevision.findUnique({
      where: { id: result.revisionId },
    })
    expect(revision?.configurationDigest).toBe(
      createHash("sha256")
        .update(JSON.stringify({ audience: "hub-1" }))
        .digest("hex"),
    )
    expect(Object.keys(revision ?? {})).not.toContain("settings")
  })

  it("persists no validated configuration value beyond its digest", async () => {
    const marker = "opaque-public-configuration-marker"

    await validateAndPersistProviderRevision(input(1, marker), dependencies())

    const records = await prisma.authenticationProviderRevision.findMany()
    expect(JSON.stringify(records)).not.toContain(marker)
    expect(records[0]?.configurationDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("does not enter a transaction or write an audit when validation fails", async () => {
    const validator = vi.fn(() => Promise.reject(new Error("provider validation failed")))
    const base = dependencies(validator)
    let transactionCalls = 0
    let auditCalls = 0
    async function runTransaction<Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ) {
      transactionCalls += 1
      return base.runTransaction(operation)
    }
    async function writeAudit(input: Parameters<typeof createSecurityAudit>[1]) {
      auditCalls += 1
      return base.writeAudit(input)
    }

    await expect(
      validateAndPersistProviderRevision(input(1), {
        ...base,
        runTransaction,
        writeAudit,
      }),
    ).rejects.toThrow("provider validation failed")
    expect(transactionCalls).toBe(0)
    expect(auditCalls).toBe(0)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(0)
    await expect(prisma.securityAudit.count()).resolves.toBe(0)
  })

  it("rejects unknown configuration and caller-supplied digest fields before persistence", async () => {
    const base = dependencies()
    const configurationWithUnknownField = {
      audience: "hub",
      opaque: "untrusted-value",
    }
    const inputWithDigest = {
      ...input(1),
      configurationDigest: "a".repeat(64),
    }

    await expect(
      validateAndPersistProviderRevision(
        {
          ...input(1),
          configuration: configurationWithUnknownField,
        },
        dependencies((candidate) => validateConfiguration(candidate)),
      ),
    ).rejects.toThrow()
    await expect(validateAndPersistProviderRevision(inputWithDigest, base)).rejects.toThrow()
    await expect(prisma.authenticationProvider.count()).resolves.toBe(0)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(0)
    await expect(prisma.securityAudit.count()).resolves.toBe(0)
  })

  it("selects monotonic revisions and returns unchanged for the same validated configuration", async () => {
    const first = await validateAndPersistProviderRevision(input(1), dependencies())
    const unchanged = await validateAndPersistProviderRevision(input(1), dependencies())
    const second = await validateAndPersistProviderRevision(input(2), dependencies())

    expect(unchanged).toEqual({ ...first, status: "unchanged" })
    expect(second).toMatchObject({
      status: "selected",
      providerId: first.providerId,
      revision: 2,
    })
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "SUCCESS" } })).resolves.toBe(2)
  })

  it("retries the database operation without repeating external validation", async () => {
    const validator = vi.fn(validateConfiguration)
    const base = dependencies(validator)
    let transactionCalls = 0
    async function runTransaction<Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ): Promise<Result> {
      transactionCalls += 1
      if (transactionCalls === 1) throw new IdentityTransactionConflictError()
      return base.runTransaction(operation)
    }

    await expect(
      validateAndPersistProviderRevision(input(1), { ...base, runTransaction }),
    ).resolves.toMatchObject({ status: "selected" })
    expect(validator).toHaveBeenCalledOnce()
    expect(transactionCalls).toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(0)
  })

  it("denies rollback, same-revision drift, and revision gaps after rollback", async () => {
    await validateAndPersistProviderRevision(input(1), dependencies())
    await validateAndPersistProviderRevision(input(2), dependencies())

    await expect(
      validateAndPersistProviderRevision(input(1), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionRollbackError)
    await expect(
      validateAndPersistProviderRevision(input(2, "changed"), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionDriftError)
    await expect(
      validateAndPersistProviderRevision(input(4), dependencies()),
    ).rejects.toBeInstanceOf(ProviderRevisionGapError)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "DENIED" } })).resolves.toBe(3)
  })

  it("rolls back partial persistence before recording a terminal failure audit", async () => {
    await validateAndPersistProviderRevision(input(1), dependencies())
    const base = dependencies()
    async function runTransaction<Result>(
      operation: (repositories: ProviderRevisionRepositories) => Promise<Result>,
    ): Promise<Result> {
      return prisma.$transaction(
        (transaction) =>
          operation({
            createAuthenticationProvider: (value) =>
              createAuthenticationProvider(transaction, value),
            createAuthenticationProviderRevision: (value) =>
              createAuthenticationProviderRevision(transaction, value),
            createSecurityAudit: (value) => createSecurityAudit(transaction, value),
            findAuthenticationProvider: (key) => findAuthenticationProvider(transaction, key),
            selectAuthenticationProviderRevision: () =>
              Promise.reject(new Error("injected selection failure")),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    }

    await expect(
      validateAndPersistProviderRevision(input(2), { ...base, runTransaction }),
    ).rejects.toThrow("injected selection failure")
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(1)
  })

  it("converges competing equal configuration to selected and unchanged", async () => {
    await validateAndPersistProviderRevision(input(1), dependencies())
    const runTransaction = controlledConcurrentTransaction()
    const first = validateAndPersistProviderRevision(input(2), {
      ...dependencies(),
      runTransaction,
    })
    const second = validateAndPersistProviderRevision(input(2), {
      ...dependencies(),
      runTransaction,
    })

    const results = await Promise.all([first, second])

    expect(results.map(({ status }) => status).sort()).toEqual(["selected", "unchanged"])
    expect(new Set(results.map(({ providerId }) => providerId)).size).toBe(1)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "SUCCESS" } })).resolves.toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(0)
  })

  it("converts competing different configuration to deterministic drift after retry", async () => {
    await validateAndPersistProviderRevision(input(1), dependencies())
    const runTransaction = controlledConcurrentTransaction()
    const first = validateAndPersistProviderRevision(input(2, "first"), {
      ...dependencies(),
      runTransaction,
    })
    const second = validateAndPersistProviderRevision(input(2, "second"), {
      ...dependencies(),
      runTransaction,
    })

    const results = await Promise.allSettled([first, second])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof ProviderRevisionDriftError,
      ),
    ).toHaveLength(1)
    await expect(prisma.authenticationProviderRevision.count()).resolves.toBe(2)
    await expect(prisma.securityAudit.count({ where: { outcome: "DENIED" } })).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(0)
  })
})
