import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import type { Prisma } from "../../generated/prisma/client"
import { prisma } from "../../integrations/prisma"
import { createAdmissionHandoff } from "../../repositories/admission-handoffs/create-admission-handoff"
import { incrementAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/increment-authentication-revocation-generation"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { hashAuthenticationValue } from "../../utils/authentication/hash-authentication-value"
import { resolveOrCreateExternalIdentity } from "../identity/resolve-or-create-external-identity"
import { runIdentityCreationTransaction } from "../identity/run-identity-creation-transaction"
import { runProviderRevisionTransaction } from "../identity/run-provider-revision-transaction"
import { validateAndPersistProviderRevision } from "../identity/validate-and-persist-provider-revision"
import { consumeAuthenticationAdmissionHandoff } from "./consume-admission-handoff"

async function selectProviderRevision(revision: number) {
  return validateAndPersistProviderRevision(
    { providerKey: "github", revision, configuration: { revision } },
    {
      createId: randomUUID,
      runTransaction: (operation) => runProviderRevisionTransaction(prisma, operation),
      validateConfiguration: () =>
        Promise.resolve({ canonicalPublicConfiguration: JSON.stringify({ revision }) }),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

async function createHandoff(providerRevisionId: string, token: string) {
  const identity = await resolveOrCreateExternalIdentity(
    { provider: "github", issuer: "https://github.com", subject: token },
    {
      createId: randomUUID,
      runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
  await createAdmissionHandoff(prisma, {
    id: randomUUID(),
    externalIdentityId: identity.externalIdentityId,
    providerRevisionId,
    tokenDigest: hashAuthenticationValue(token),
    browserBindingDigest: hashAuthenticationValue("browser"),
    revocationGeneration: 1n,
    displayAttributes: { login: "octocat", name: null, avatarUrl: null, email: null },
    expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
  })
}

function barrierDatabase(model: "authenticationProvider" | "authenticationRevocationGeneration") {
  let arrivedResolve!: () => void
  let releaseResolve!: () => void
  const arrived = new Promise<void>((resolve) => {
    arrivedResolve = resolve
  })
  const release = new Promise<void>((resolve) => {
    releaseResolve = resolve
  })
  return {
    arrived,
    release: releaseResolve,
    database: {
      $transaction<Result>(
        operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
        options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
      ) {
        return prisma.$transaction(async (transaction) => {
          const wrapped = new Proxy(transaction, {
            get(target, property) {
              if (property !== model) {
                return target[property as keyof Prisma.TransactionClient]
              }
              if (model === "authenticationProvider") {
                const delegate = transaction.authenticationProvider
                return {
                  ...delegate,
                  async findUnique(input: Parameters<typeof delegate.findUnique>[0]) {
                    const result = await delegate.findUnique(input)
                    arrivedResolve()
                    await release
                    return result
                  },
                }
              }
              const delegate = transaction.authenticationRevocationGeneration
              return {
                ...delegate,
                async findUnique(input: Parameters<typeof delegate.findUnique>[0]) {
                  const result = await delegate.findUnique(input)
                  arrivedResolve()
                  await release
                  return result
                },
              }
            },
          })
          return operation(wrapped)
        }, options)
      },
    },
  }
}

describe("authentication handoff races", () => {
  it("serializes global revocation after an in-flight handoff consumption", async () => {
    const provider = await selectProviderRevision(1)
    await createHandoff(provider.revisionId, "revocation-race")
    const barrier = barrierDatabase("authenticationRevocationGeneration")
    const consumption = consumeAuthenticationAdmissionHandoff(barrier.database, {
      handoffToken: "revocation-race",
      browserBinding: "browser",
      providerKey: "github",
      now: new Date(Date.now() + 1_000),
    })

    await barrier.arrived
    let revocationCompleted = false
    const revocation = incrementAuthenticationRevocationGeneration(prisma).then(() => {
      revocationCompleted = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(revocationCompleted).toBe(false)
    barrier.release()

    await expect(consumption).resolves.toMatchObject({ status: "consumed" })
    await revocation
  })

  it("serializes provider revision selection after an in-flight handoff consumption", async () => {
    const provider = await selectProviderRevision(1)
    await createHandoff(provider.revisionId, "revision-race")
    const barrier = barrierDatabase("authenticationProvider")
    const consumption = consumeAuthenticationAdmissionHandoff(barrier.database, {
      handoffToken: "revision-race",
      browserBinding: "browser",
      providerKey: "github",
      now: new Date(Date.now() + 1_000),
    })

    await barrier.arrived
    let selectionCompleted = false
    const selection = selectProviderRevision(2).then(() => {
      selectionCompleted = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(selectionCompleted).toBe(false)
    barrier.release()

    await expect(consumption).resolves.toMatchObject({ status: "consumed" })
    await selection
  })
})
