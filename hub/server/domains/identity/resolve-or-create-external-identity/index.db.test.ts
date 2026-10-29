import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { Prisma } from "../../../generated/prisma/client"
import { prisma } from "../../../integrations/prisma"
import { createExternalIdentity } from "../../../repositories/external-identities/create-external-identity"
import { findExternalIdentity } from "../../../repositories/external-identities/find-external-identity"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit"
import { createUser } from "../../../repositories/users/create-user"
import { ExternalIdentityCollisionError, IdentityTransactionConflictError } from "../errors"
import { runIdentityCreationTransaction } from "../run-identity-creation-transaction"
import type {
  IdentityCreationRepositories,
  IdentityCreationTransaction,
} from "../run-identity-creation-transaction/types"
import { resolveOrCreateExternalIdentity } from "."

const tuple = {
  provider: "workforce",
  issuer: "https://id.example.test",
  subject: "person-123",
}

function dependencies(createId = randomUUID) {
  return {
    createId,
    runTransaction: <Result>(
      operation: (repositories: IdentityCreationRepositories) => Promise<Result>,
    ) => runIdentityCreationTransaction(prisma, operation),
    writeAudit: (input: Parameters<typeof createSecurityAudit>[1]) =>
      createSecurityAudit(prisma, input),
  }
}

function controlledConcurrentTransaction(): IdentityCreationTransaction {
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
            createExternalIdentity: (input) => createExternalIdentity(transaction, input),
            createSecurityAudit: (input) => createSecurityAudit(transaction, input),
            createUser: (input) => createUser(transaction, input),
            findExternalIdentity: async (input) => {
              const identity = await findExternalIdentity(transaction, input)
              if (!identity) {
                arrivals += 1
                if (arrivals === 2) release?.()
                await overlap
              }
              return identity
            },
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

describe("resolveOrCreateExternalIdentity()", () => {
  it("atomically creates a user, immutable external identity, and success audit", async () => {
    const result = await resolveOrCreateExternalIdentity(tuple, dependencies())

    expect(result.status).toBe("created")
    await expect(prisma.user.findMany()).resolves.toEqual([
      expect.objectContaining({ id: result.userId }),
    ])
    await expect(prisma.externalIdentity.findMany()).resolves.toEqual([
      expect.objectContaining({
        id: result.externalIdentityId,
        userId: result.userId,
        ...tuple,
      }),
    ])
    await expect(prisma.securityAudit.findMany()).resolves.toEqual([
      expect.objectContaining({
        action: "identity.external.created",
        outcome: "SUCCESS",
        targetId: result.externalIdentityId,
        context: { provider: tuple.provider, issuer: tuple.issuer },
      }),
    ])
  })

  it("resolves an existing immutable tuple without creating another user or audit", async () => {
    const created = await resolveOrCreateExternalIdentity(tuple, dependencies())
    const resolved = await resolveOrCreateExternalIdentity(tuple, dependencies())

    expect(resolved).toEqual({ ...created, status: "found" })
    await expect(prisma.user.count()).resolves.toBe(1)
    await expect(prisma.externalIdentity.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count()).resolves.toBe(1)
  })

  it("rolls back a user collision before writing a bounded failure audit", async () => {
    const collidedUserId = randomUUID()
    await createUser(prisma, { id: collidedUserId })
    const ids = [collidedUserId, randomUUID(), randomUUID(), randomUUID()][Symbol.iterator]()

    await expect(
      resolveOrCreateExternalIdentity(
        tuple,
        dependencies(() => ids.next().value!),
      ),
    ).rejects.toBeInstanceOf(ExternalIdentityCollisionError)
    await expect(prisma.user.count()).resolves.toBe(1)
    await expect(prisma.externalIdentity.count()).resolves.toBe(0)
    await expect(prisma.securityAudit.findMany()).resolves.toEqual([
      expect.objectContaining({
        action: "identity.external.create_failed",
        outcome: "FAILURE",
        context: {
          provider: tuple.provider,
          issuer: tuple.issuer,
          reason: "collision",
        },
      }),
    ])
  })

  it("rolls back partial state before auditing an unexpected transaction failure", async () => {
    const base = dependencies()
    async function runTransaction<Result>(
      operation: (repositories: IdentityCreationRepositories) => Promise<Result>,
    ): Promise<Result> {
      return prisma.$transaction(
        (transaction) =>
          operation({
            createExternalIdentity: () => Promise.reject(new Error("injected failure")),
            createSecurityAudit: (input) => createSecurityAudit(transaction, input),
            createUser: (input) => createUser(transaction, input),
            findExternalIdentity: (input) => findExternalIdentity(transaction, input),
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    }

    await expect(
      resolveOrCreateExternalIdentity(tuple, { ...base, runTransaction }),
    ).rejects.toThrow("injected failure")
    await expect(prisma.user.count()).resolves.toBe(0)
    await expect(prisma.externalIdentity.count()).resolves.toBe(0)
    const audits = await prisma.securityAudit.findMany()
    expect(audits).toHaveLength(1)
    expect(audits[0]?.action).toBe("identity.external.create_failed")
    expect(audits[0]?.outcome).toBe("FAILURE")
    expect(audits[0]?.context).toEqual({
      provider: tuple.provider,
      issuer: tuple.issuer,
      reason: "transaction_error",
    })
  })

  it("overlaps competing creations and commits exactly one complete identity", async () => {
    const runTransaction = controlledConcurrentTransaction()
    const first = resolveOrCreateExternalIdentity(tuple, {
      ...dependencies(),
      runTransaction,
    })
    const second = resolveOrCreateExternalIdentity(tuple, {
      ...dependencies(),
      runTransaction,
    })

    const results = await Promise.allSettled([first, second])

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === "rejected" && result.reason instanceof ExternalIdentityCollisionError,
      ),
    ).toHaveLength(1)
    await expect(prisma.user.count()).resolves.toBe(1)
    await expect(prisma.externalIdentity.count()).resolves.toBe(1)
    await expect(
      prisma.securityAudit.groupBy({ by: ["outcome"], _count: { _all: true } }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "SUCCESS", _count: { _all: 1 } }),
        expect.objectContaining({ outcome: "FAILURE", _count: { _all: 1 } }),
      ]),
    )
  })
})
