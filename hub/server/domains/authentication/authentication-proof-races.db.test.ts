import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { prisma } from "../../integrations/prisma"
import { lockAuthenticationProviderSelection } from "../../repositories/authentication-providers/lock-authentication-provider-selection"
import { incrementAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/increment-authentication-revocation-generation"
import { lockAuthenticationRevocationGeneration } from "../../repositories/authentication-revocation-generations/lock-authentication-revocation-generation"
import { createSecurityAudit } from "../../repositories/security-audits/create-security-audit"
import { hashAuthenticationValue } from "../../utils/authentication/hash-authentication-value"
import { resolveOrCreateExternalIdentity } from "../identity/resolve-or-create-external-identity"
import { runIdentityCreationTransaction } from "../identity/run-identity-creation-transaction"
import { runProviderRevisionTransaction } from "../identity/run-provider-revision-transaction"
import { validateAndPersistProviderRevision } from "../identity/validate-and-persist-provider-revision"
import { createAuthenticationAdmissionHandoff } from "./create-admission-handoff"
import { consumeAuthenticationAdmissionHandoff } from "./consume-admission-handoff"
import { runAdmissionHandoffTransaction } from "./run-admission-handoff-transaction"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

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

async function createIdentity(subject: string) {
  return resolveOrCreateExternalIdentity(
    { provider: "github", issuer: "https://github.com", subject },
    {
      createId: randomUUID,
      runTransaction: (operation) => runIdentityCreationTransaction(prisma, operation),
      writeAudit: (event) => createSecurityAudit(prisma, event),
    },
  )
}

function handoffInput(externalIdentityId: string, providerRevisionId: string, token: string) {
  return {
    browserBindingDigest: hashAuthenticationValue("browser"),
    displayAttributes: { login: "octocat", name: null, avatarUrl: null, email: null },
    expectedRevocationGeneration: 1n,
    expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
    externalIdentityId,
    providerKey: "github",
    providerRevisionId,
    tokenDigest: hashAuthenticationValue(token),
  }
}

function barrierTransaction(target: "provider" | "revocation") {
  const arrived = deferred()
  const release = deferred()
  return {
    arrived: arrived.promise,
    release: release.resolve,
    runTransaction: <Result>(
      operation: Parameters<typeof runAdmissionHandoffTransaction<Result>>[1],
    ) =>
      runAdmissionHandoffTransaction(prisma, operation, {
        lockProvider: async (database, providerKey) => {
          await lockAuthenticationProviderSelection(database, providerKey)
          if (target === "provider") {
            arrived.resolve()
            await release.promise
          }
        },
        lockRevocation: async (database) => {
          await lockAuthenticationRevocationGeneration(database)
          if (target === "revocation") {
            arrived.resolve()
            await release.promise
          }
        },
      }),
  }
}

describe("authentication handoff creation races", () => {
  it("serializes provider revision selection after the locked creation decision", async () => {
    const provider = await selectProviderRevision(1)
    const identity = await createIdentity("provider-creation-race")
    const barrier = barrierTransaction("provider")
    const creation = createAuthenticationAdmissionHandoff(
      handoffInput(identity.externalIdentityId, provider.revisionId, "provider-race"),
      { runTransaction: barrier.runTransaction },
    )

    await barrier.arrived
    let selectionCompleted = false
    const selectionStarted = deferred()
    const selection = (async () => {
      selectionStarted.resolve()
      await selectProviderRevision(2)
      selectionCompleted = true
    })()
    await selectionStarted.promise
    expect(selectionCompleted).toBe(false)
    barrier.release()

    await expect(creation).resolves.toEqual({ status: "created" })
    await selection
    await expect(prisma.admissionHandoff.count()).resolves.toBe(1)
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.handoff.created" } }),
    ).resolves.toBe(1)
  })

  describe("authentication handoff consumption races", () => {
    it.each(["provider", "revocation"] as const)(
      "serializes %s changes after the locked consumption decision",
      async (target) => {
        const provider = await selectProviderRevision(1)
        const identity = await createIdentity(`${target}-consumption-race`)
        const token = `${target}-consumption-token`
        await createAuthenticationAdmissionHandoff(
          handoffInput(identity.externalIdentityId, provider.revisionId, token),
          {
            runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
          },
        )
        const barrier = barrierTransaction(target)
        const consumption = consumeAuthenticationAdmissionHandoff(
          {
            browserBinding: "browser",
            handoffToken: token,
            now: new Date(Date.now() + 1_000),
            providerKey: "github",
          },
          { runTransaction: barrier.runTransaction },
        )

        await barrier.arrived
        let changeCompleted = false
        const changeStarted = deferred()
        const change = (async () => {
          changeStarted.resolve()
          if (target === "provider") await selectProviderRevision(2)
          else await incrementAuthenticationRevocationGeneration(prisma)
          changeCompleted = true
        })()
        await changeStarted.promise
        expect(changeCompleted).toBe(false)
        barrier.release()

        await expect(consumption).resolves.toMatchObject({ status: "consumed" })
        await change
        await expect(
          prisma.securityAudit.count({ where: { action: "authentication.handoff.consumed" } }),
        ).resolves.toBe(1)
      },
    )
  })

  it("serializes global revocation after the locked creation decision", async () => {
    const provider = await selectProviderRevision(1)
    const identity = await createIdentity("revocation-creation-race")
    const barrier = barrierTransaction("revocation")
    const creation = createAuthenticationAdmissionHandoff(
      handoffInput(identity.externalIdentityId, provider.revisionId, "revocation-race"),
      { runTransaction: barrier.runTransaction },
    )

    await barrier.arrived
    let revocationCompleted = false
    const revocationStarted = deferred()
    const revocation = (async () => {
      revocationStarted.resolve()
      await incrementAuthenticationRevocationGeneration(prisma)
      revocationCompleted = true
    })()
    await revocationStarted.promise
    expect(revocationCompleted).toBe(false)
    barrier.release()

    await expect(creation).resolves.toEqual({ status: "created" })
    await revocation
    await expect(prisma.admissionHandoff.count()).resolves.toBe(1)
  })

  it("returns restart without a handoff or success audit after observed drift", async () => {
    const provider = await selectProviderRevision(1)
    const identity = await createIdentity("observed-drift")
    await selectProviderRevision(2)

    await expect(
      createAuthenticationAdmissionHandoff(
        handoffInput(identity.externalIdentityId, provider.revisionId, "revision-drift"),
        {
          runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
        },
      ),
    ).resolves.toEqual({ status: "restart", reason: "provider_revision_changed" })
    await expect(prisma.admissionHandoff.count()).resolves.toBe(0)
    await expect(
      prisma.securityAudit.count({ where: { action: "authentication.handoff.created" } }),
    ).resolves.toBe(0)

    const selected = await selectProviderRevision(2)
    await incrementAuthenticationRevocationGeneration(prisma)
    await expect(
      createAuthenticationAdmissionHandoff(
        handoffInput(identity.externalIdentityId, selected.revisionId, "revocation-drift"),
        {
          runTransaction: (operation) => runAdmissionHandoffTransaction(prisma, operation),
        },
      ),
    ).resolves.toEqual({ status: "restart", reason: "revoked" })
    await expect(prisma.admissionHandoff.count()).resolves.toBe(0)
  })
})
