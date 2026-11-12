import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { CopilotTokenCheckError } from "../../../integrations/copilot/check-copilot-token/errors.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { lockCopilotConnectionState } from "../../../repositories/copilot-connection-state/lock-copilot-connection-state/index.ts"
import { saveCopilotConnectionState } from "../../../repositories/copilot-connection-state/save-copilot-connection-state/index.ts"
import { lockLiveHubSession } from "../../../repositories/hub-sessions/lock-live-hub-session/index.ts"
import { lockEffectiveAdministratorProviders } from "../../../repositories/authentication-providers/lock-effective-administrator-providers/index.ts"
import { lockEffectiveAdministrators } from "../../../repositories/memberships/lock-effective-administrators/index.ts"
import { lockSensitiveAuthorization } from "../../../repositories/sensitive-authorizations/lock-sensitive-authorization/index.ts"
import { markSensitiveAuthorizationContinued } from "../../../repositories/sensitive-authorizations/mark-sensitive-authorization-continued/index.ts"
import { CopilotConnectionDeniedError, CopilotConnectionUnavailableError } from "../errors.ts"

const inputSchema = z
  .object({
    authorizationId: z.uuid(),
    hubSessionId: z.uuid(),
    operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
    token: z.string().min(1).optional(),
  })
  .strict()

export async function continueCopilotAuthorization(
  database: PrismaClientLike,
  rawInput: unknown,
  checkToken: (token: string) => Promise<void>,
) {
  const input = inputSchema.parse(rawInput)
  try {
    await requireCurrentAuthorization(database, input)
  } catch (error) {
    if (
      error instanceof CopilotConnectionDeniedError &&
      (error.reason === "connection_changed" || error.reason === "not_connected")
    ) {
      await recordFailure(database, input, error.reason, "denied")
    }
    throw error
  }
  let tokenDigest: string | undefined
  if (input.operation === "CONNECT_COPILOT") {
    if (!input.token) {
      const reason = await recordFailure(database, input, "no_token", "denied")
      if (reason === "unavailable") {
        throw new CopilotConnectionUnavailableError("Copilot could not check the configured token.")
      }
      throw new CopilotConnectionDeniedError(reason)
    }
    try {
      await checkToken(input.token)
      tokenDigest = createHash("sha256").update(input.token).digest("hex")
    } catch (error) {
      const reason =
        error instanceof CopilotTokenCheckError && error.reason === "refused"
          ? "refused"
          : "unavailable"
      const recordedReason = await recordFailure(
        database,
        input,
        reason,
        reason === "refused" ? "denied" : "failure",
      )
      if (recordedReason !== "unavailable") {
        throw new CopilotConnectionDeniedError(recordedReason)
      }
      throw new CopilotConnectionUnavailableError("Copilot could not check the configured token.", {
        cause: error,
      })
    }
  }

  try {
    return await database.$transaction(
      async (transaction) => {
        const authorization = await lockSensitiveAuthorization(transaction, input.authorizationId)
        if (
          !authorization ||
          authorization.hubSessionId !== input.hubSessionId ||
          authorization.operation !== input.operation ||
          authorization.targetMembershipIds.length !== 1 ||
          authorization.targetMembershipIds[0] !== authorization.actorMembershipId ||
          authorization.cancelledAt ||
          authorization.continuedAt ||
          authorization.expired ||
          !authorization.verifiedAt ||
          !(await lockLiveHubSession(transaction, input.hubSessionId))
        ) {
          throw new CopilotConnectionDeniedError("authorization_unavailable")
        }
        await lockEffectiveAdministratorProviders(transaction)
        const administrators = await lockEffectiveAdministrators(transaction)
        if (
          !administrators.some(
            ({ membershipId }) => membershipId === authorization.actorMembershipId,
          )
        ) {
          throw new CopilotConnectionDeniedError("authorization_unavailable")
        }
        const state = await lockCopilotConnectionState(transaction)
        if (
          !state ||
          authorization.expectedCopilotGeneration === null ||
          state.generation !== authorization.expectedCopilotGeneration
        ) {
          throw new CopilotConnectionDeniedError("connection_changed")
        }
        if (input.operation === "DISCONNECT_COPILOT" && !state.connectedByMembershipId) {
          throw new CopilotConnectionDeniedError("not_connected")
        }
        await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
        await saveCopilotConnectionState(
          transaction,
          input.operation === "CONNECT_COPILOT"
            ? {
                membershipId: authorization.actorMembershipId,
                operation: "connect",
                tokenDigest: tokenDigest!,
              }
            : { operation: "disconnect" },
        )
        await createSecurityAudit(transaction, {
          actorMembershipId: authorization.actorMembershipId,
          id: randomUUID(),
          operation: input.operation === "CONNECT_COPILOT" ? "connect" : "disconnect",
          outcome: "success",
          type: "copilot_connection",
        })
        await createSecurityAudit(transaction, {
          actorMembershipId: authorization.actorMembershipId,
          authorizationId: input.authorizationId,
          id: randomUUID(),
          operation: input.operation,
          phase: "completed",
          targetCount: 1,
          type: "administrator_authorization",
        })
        return { connected: input.operation === "CONNECT_COPILOT" }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (error) {
    if (
      error instanceof CopilotConnectionDeniedError &&
      (error.reason === "connection_changed" || error.reason === "not_connected")
    ) {
      await recordFailure(database, input, error.reason, "denied")
    }
    throw error
  }
}

interface PrismaClientLike {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

async function requireCurrentAuthorization(
  database: PrismaClientLike,
  input: z.infer<typeof inputSchema>,
) {
  await database.$transaction(async (transaction) => {
    const authorization = await lockSensitiveAuthorization(transaction, input.authorizationId)
    if (
      !authorization ||
      authorization.hubSessionId !== input.hubSessionId ||
      authorization.operation !== input.operation ||
      authorization.targetMembershipIds.length !== 1 ||
      authorization.targetMembershipIds[0] !== authorization.actorMembershipId ||
      authorization.cancelledAt ||
      authorization.continuedAt ||
      authorization.expired ||
      !authorization.verifiedAt ||
      !(await lockLiveHubSession(transaction, input.hubSessionId))
    ) {
      throw new CopilotConnectionDeniedError("authorization_unavailable")
    }
    await lockEffectiveAdministratorProviders(transaction)
    const administrators = await lockEffectiveAdministrators(transaction)
    if (
      !administrators.some(({ membershipId }) => membershipId === authorization.actorMembershipId)
    ) {
      throw new CopilotConnectionDeniedError("authorization_unavailable")
    }
    const state = await lockCopilotConnectionState(transaction)
    if (
      !state ||
      authorization.expectedCopilotGeneration === null ||
      state.generation !== authorization.expectedCopilotGeneration
    ) {
      throw new CopilotConnectionDeniedError("connection_changed")
    }
    if (input.operation === "DISCONNECT_COPILOT" && !state.connectedByMembershipId) {
      throw new CopilotConnectionDeniedError("not_connected")
    }
  })
}

async function recordFailure(
  database: PrismaClientLike,
  input: z.infer<typeof inputSchema>,
  reason: "connection_changed" | "no_token" | "not_connected" | "refused" | "unavailable",
  outcome: "denied" | "failure",
): Promise<
  | "authorization_unavailable"
  | "connection_changed"
  | "no_token"
  | "not_connected"
  | "refused"
  | "unavailable"
> {
  return database.$transaction(async (transaction) => {
    const authorization = await lockSensitiveAuthorization(transaction, input.authorizationId)
    if (
      !authorization ||
      authorization.hubSessionId !== input.hubSessionId ||
      authorization.operation !== input.operation ||
      authorization.cancelledAt ||
      authorization.continuedAt ||
      authorization.expired ||
      !authorization.verifiedAt ||
      !(await lockLiveHubSession(transaction, input.hubSessionId))
    ) {
      return "authorization_unavailable"
    }
    const state = await lockCopilotConnectionState(transaction)
    let recordedReason = reason
    if (
      !state ||
      authorization.expectedCopilotGeneration === null ||
      state.generation !== authorization.expectedCopilotGeneration
    ) {
      recordedReason = "connection_changed"
    }
    await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
    await createSecurityAudit(transaction, {
      actorMembershipId: authorization.actorMembershipId,
      id: randomUUID(),
      operation: input.operation === "CONNECT_COPILOT" ? "connect" : "disconnect",
      outcome,
      reason: recordedReason,
      type: "copilot_connection",
    })
    await createSecurityAudit(transaction, {
      actorMembershipId: authorization.actorMembershipId,
      authorizationId: input.authorizationId,
      id: randomUUID(),
      operation: input.operation,
      phase: "denied",
      reason: recordedReason,
      targetCount: 1,
      type: "administrator_authorization",
    })
    return recordedReason
  })
}
