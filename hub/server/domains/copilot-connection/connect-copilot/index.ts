import { createHash } from "node:crypto"
import { z } from "zod"

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
    sessionDigest,
    token,
  }: {
    sessionDigest: string
    token: string | null
  },
  {
    check,
    createId,
    findAdministratorSession,
    now,
    readSnapshot,
    recordRefusal,
    runTransaction,
    writeAudit,
  }: {
    check: (token: string) => Promise<unknown>
    createId: () => string
    findAdministratorSession: (sessionDigest: string) => Promise<{ membershipId: string } | null>
    now: () => Date
    readSnapshot: () => Promise<CopilotConnectionSnapshot>
    recordRefusal: (input: {
      actorMembershipId: string
      at: Date
      snapshot: CopilotConnectionSnapshot
      tokenDigest: string
    }) => Promise<void>
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
  if (!token) {
    await writeAudit({
      actorMembershipId: actor.membershipId,
      id: createId(),
      phase: "denied",
      reason: "token_missing",
      type: "copilot_connection",
    })
    throw new CopilotConnectionError("token_missing", "Hub has no Copilot token.")
  }
  const snapshot = await readSnapshot()
  try {
    statusSchema.parse(await check(token))
  } catch (error) {
    const refused = error instanceof LearningCommandError && error.code === "unauthorized"
    if (refused) {
      await recordRefusal({
        actorMembershipId: actor.membershipId,
        at: now(),
        snapshot,
        tokenDigest: createHash("sha256").update(token).digest("hex"),
      })
    } else {
      await writeAudit({
        actorMembershipId: actor.membershipId,
        id: createId(),
        phase: "failed",
        reason: "status_check_failed",
        type: "copilot_connection",
      })
    }
    throw new CopilotConnectionError(
      refused ? "token_refused" : "unavailable",
      refused
        ? "Copilot refused the configured token."
        : "Hub could not check the configured Copilot token.",
      { cause: error },
    )
  }
  return runTransaction(async (repositories) => {
    const session = await repositories.findAdministratorSession(sessionDigest)
    if (!session) {
      throw new CopilotConnectionError("not_authorized", "Administrator access is required.")
    }
    const state = await repositories.lockState()
    const current = await repositories.getConnection()
    if (
      !state ||
      state.generation !== snapshot.generation ||
      (current?.id ?? null) !== snapshot.connectionId
    ) {
      throw new CopilotConnectionError(
        "connection_changed",
        "The Copilot connection changed while Hub checked the token.",
      )
    }
    const connectionId = createId()
    await repositories.replaceConnection({
      connectedByMembershipId: session.membershipId,
      id: connectionId,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      verifiedAt: now(),
    })
    await repositories.advanceState()
    await repositories.writeAudit({
      actorMembershipId: session.membershipId,
      connectionId,
      id: createId(),
      phase: "connected",
      type: "copilot_connection",
    })
    return { connectionId }
  })
}
