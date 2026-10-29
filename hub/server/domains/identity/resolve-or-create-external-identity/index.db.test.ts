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
    retry: {
      baseDelayMs: 0,
      maxAttempts: 3,
      maxDelayMs: 0,
      sleep: () => Promise.resolve(),
    },
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

  it("retries generated user ID collisions before creating the identity", async () => {
    const collidedUserId = randomUUID()
    await createUser(prisma, { id: collidedUserId })
    const ids = [
      collidedUserId,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ][Symbol.iterator]()

    const result = await resolveOrCreateExternalIdentity(
      tuple,
      dependencies(() => ids.next().value!),
    )

    expect(result.status).toBe("created")
    expect(result.userId).not.toBe(collidedUserId)
    await expect(prisma.user.count()).resolves.toBe(2)
    await expect(prisma.externalIdentity.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(0)
  })

  it("writes one failure audit only after the retry budget is exhausted", async () => {
    const collidedUserId = randomUUID()
    await createUser(prisma, { id: collidedUserId })
    const configured = dependencies(() => collidedUserId)

    await expect(
      resolveOrCreateExternalIdentity(tuple, {
        ...configured,
        retry: { ...configured.retry, maxAttempts: 2 },
      }),
    ).rejects.toBeInstanceOf(ExternalIdentityCollisionError)
    await expect(prisma.externalIdentity.count()).resolves.toBe(0)
    await expect(prisma.securityAudit.findMany()).resolves.toEqual([
      expect.objectContaining({
        action: "identity.external.create_failed",
        outcome: "FAILURE",
        context: {
          provider: tuple.provider,
          issuer: tuple.issuer,
          reason: "retry_exhausted",
        },
      }),
    ])
  })

  it("rejects excess and non-plain input before attaching an identity to a victim", async () => {
    const victimUserId = randomUUID()
    await createUser(prisma, { id: victimUserId })
    class IdentityInput {
      provider = tuple.provider
      issuer = tuple.issuer
      subject = tuple.subject
    }

    for (const input of [
      { ...tuple, id: randomUUID() },
      { ...tuple, userId: victimUserId },
      { ...tuple, provider: { value: tuple.provider } },
      new IdentityInput(),
    ]) {
      await expect(resolveOrCreateExternalIdentity(input, dependencies())).rejects.toThrow()
    }

    await expect(prisma.user.findMany()).resolves.toEqual([
      expect.objectContaining({ id: victimUserId }),
    ])
    await expect(prisma.externalIdentity.count()).resolves.toBe(0)
    await expect(prisma.securityAudit.count()).resolves.toBe(0)
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

    const results = await Promise.all([first, second])

    expect(results.map(({ status }) => status).sort()).toEqual(["created", "found"])
    expect(new Set(results.map(({ userId }) => userId)).size).toBe(1)
    await expect(prisma.user.count()).resolves.toBe(1)
    await expect(prisma.externalIdentity.count()).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { outcome: "SUCCESS" } })).resolves.toBe(1)
    await expect(prisma.securityAudit.count({ where: { outcome: "FAILURE" } })).resolves.toBe(0)
  })
})
