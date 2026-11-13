import { z } from "zod"

import type { CopilotCredentialProviderKey } from "../../copilot-credentials/types.ts"
import { LearningCommandError } from "../../../integrations/learning/run-learning-command/errors.ts"
import { CopilotConnectionError } from "../errors.ts"
import type {
  CopilotConnectionSnapshot,
  CopilotConnectionTransactionRepositories,
} from "../types.ts"

const statusSchema = z
  .object({
    signedIn: z.literal(true),
    login: z.string().nullable(),
    models: z.array(z.string()),
  })
  .loose()

export async function connectCopilot(
  {
    authorizationId,
    credentialProvider,
    hubSessionId,
    sessionDigest,
  }: {
    authorizationId?: string
    credentialProvider: {
      configurationDigest: string | null
      key: CopilotCredentialProviderKey
    }
    hubSessionId?: string
    sessionDigest: string
  },
  {
    check,
    createId,
    findAdministratorSession,
    now,
    readSnapshot,
    recordFailure,
    recordRefusal,
    runTransaction,
    writeAudit,
  }: {
    check: () => Promise<unknown>
    createId: () => string
    findAdministratorSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
    now: () => Date
    readSnapshot: () => Promise<CopilotConnectionSnapshot>
    recordFailure: (input: {
      credentialProvider: CopilotCredentialProviderKey
      sessionDigest: string
    }) => Promise<boolean>
    recordRefusal: (input: {
      at: Date
      credentialDigest: string
      credentialProvider: CopilotCredentialProviderKey
      sessionDigest: string
      snapshot: CopilotConnectionSnapshot
    }) => Promise<"connection_changed" | "not_authorized" | "recorded">
    runTransaction: <T>(
      operation: (repositories: CopilotConnectionTransactionRepositories) => Promise<T>,
    ) => Promise<T>
    writeAudit: (
      input: Parameters<CopilotConnectionTransactionRepositories["writeAudit"]>[0],
    ) => Promise<unknown>
  },
) {
  const actor = await findAdministratorSession(sessionDigest)
  if (!actor) {
    throw new CopilotConnectionError("not_authorized", "Administrator access is required.")
  }
  if (!credentialProvider.configurationDigest) {
    await writeAudit({
      actorMembershipId: actor.membershipId,
      credentialProvider: credentialProvider.key,
      id: createId(),
      phase: "denied",
      reason: "credential_missing",
      type: "copilot_connection",
    })
    throw new CopilotConnectionError(
      "credential_missing",
      "Hub has no configured Copilot credential.",
    )
  }
  const credentialDigest = credentialProvider.configurationDigest
  const snapshot = await readSnapshot()
  try {
    statusSchema.parse(await check())
  } catch (error) {
    const refused = error instanceof LearningCommandError && error.code === "unauthorized"
    if (refused) {
      const result = await recordRefusal({
        at: now(),
        credentialDigest,
        credentialProvider: credentialProvider.key,
        sessionDigest,
        snapshot,
      })
      if (result === "not_authorized") {
        throw new CopilotConnectionError("not_authorized", "Administrator access is required.", {
          cause: error,
        })
      }
      if (result === "connection_changed") {
        throw new CopilotConnectionError(
          "connection_changed",
          "The Copilot connection changed while Hub checked the credential.",
          { cause: error },
        )
      }
    } else {
      if (
        !(await recordFailure({
          credentialProvider: credentialProvider.key,
          sessionDigest,
        }))
      ) {
        throw new CopilotConnectionError("not_authorized", "Administrator access is required.", {
          cause: error,
        })
      }
    }
    throw new CopilotConnectionError(
      refused ? "credential_refused" : "unavailable",
      refused
        ? "Copilot refused the configured credential."
        : "Hub could not check the configured Copilot credential.",
      { cause: error },
    )
  }
  return runTransaction(async (repositories) => {
    const state = await repositories.lockState()
    const session = await repositories.lockAdministratorSession(sessionDigest)
    if (!session) {
      throw new CopilotConnectionError("not_authorized", "Administrator access is required.")
    }
    const current = await repositories.getConnection()
    if (
      !state ||
      state.generation !== snapshot.generation ||
      (current?.id ?? null) !== snapshot.connectionId
    ) {
      throw new CopilotConnectionError(
        "connection_changed",
        "The Copilot connection changed while Hub checked the credential.",
      )
    }
    if (
      authorizationId &&
      (!hubSessionId ||
        !repositories.continueAuthorization ||
        !(await repositories.continueAuthorization({
          actorMembershipId: session.membershipId,
          authorizationId,
          hubSessionId,
          operation: "CONNECT_COPILOT",
        })))
    ) {
      throw new CopilotConnectionError(
        "not_authorized",
        "The Copilot authorization is no longer available.",
      )
    }
    if (authorizationId) {
      await repositories.writeAudit({
        actorMembershipId: session.membershipId,
        authorizationId,
        id: createId(),
        operation: "CONNECT_COPILOT",
        phase: "completed",
        targetCount: 1,
        type: "administrator_authorization",
      })
    }
    const connectionId = createId()
    await repositories.replaceConnection({
      connectedByMembershipId: session.membershipId,
      credentialDigest,
      credentialProvider: credentialProvider.key,
      id: connectionId,
      verifiedAt: now(),
    })
    await repositories.clearRefusal()
    await repositories.advanceState()
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      connectionId,
      credentialProvider: credentialProvider.key,
      id: createId(),
      phase: "connected",
      type: "copilot_connection",
    })
    return { connectionId }
  })
}
