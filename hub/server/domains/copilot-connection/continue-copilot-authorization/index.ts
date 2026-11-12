import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { Prisma } from "../../../generated/prisma/client.ts"

import { CopilotTokenCheckError } from "../../../integrations/copilot/check-copilot-token/errors.ts"
import { classifyPrismaTransactionError } from "../../../integrations/prisma/classify-transaction-error/index.ts"
import { lockEffectiveAdministratorProviders } from "../../../repositories/authentication-providers/lock-effective-administrator-providers/index.ts"
import { lockCopilotConnectionState } from "../../../repositories/copilot-connection-state/lock-copilot-connection-state/index.ts"
import { saveCopilotConnectionState } from "../../../repositories/copilot-connection-state/save-copilot-connection-state/index.ts"
import { lockLiveHubSession } from "../../../repositories/hub-sessions/lock-live-hub-session/index.ts"
import { lockEffectiveAdministrators } from "../../../repositories/memberships/lock-effective-administrators/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { claimCopilotAuthorizationCheck } from "../../../repositories/sensitive-authorizations/claim-copilot-authorization-check/index.ts"
import { finishCopilotAuthorizationCheck } from "../../../repositories/sensitive-authorizations/finish-copilot-authorization-check/index.ts"
import { finishCopilotAuthorizationWithFailure } from "../../../repositories/sensitive-authorizations/finish-copilot-authorization-with-failure/index.ts"
import { isSensitiveAuthorizationCurrent } from "../../../repositories/sensitive-authorizations/is-sensitive-authorization-current/index.ts"
import { lockSensitiveAuthorization } from "../../../repositories/sensitive-authorizations/lock-sensitive-authorization/index.ts"
import { markSensitiveAuthorizationContinued } from "../../../repositories/sensitive-authorizations/mark-sensitive-authorization-continued/index.ts"
import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  CopilotConnectionDeniedError,
  CopilotConnectionTransactionConflictError,
  CopilotConnectionUnavailableError,
} from "../errors.ts"

const maximumConcurrentChecks = 4
const inputSchema = z
  .object({
    authorizationId: z.uuid(),
    hubSessionId: z.uuid(),
    operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
    token: z.string().min(1).optional(),
  })
  .strict()

interface PrismaClientLike {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<Result>
}

type Input = z.infer<typeof inputSchema>
type FailureReason =
  | "authorization_unavailable"
  | "connection_changed"
  | "no_token"
  | "not_connected"
  | "refused"
  | "retry_exhausted"
  | "unavailable"

function isConflict(error: unknown) {
  return error instanceof CopilotConnectionTransactionConflictError
}

async function runSerializable<Result>(
  database: PrismaClientLike,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
) {
  return runWithBoundedRetries(
    () =>
      database
        .$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
        .catch((error: unknown) => {
          if (classifyPrismaTransactionError(error) === "retryable") {
            throw new CopilotConnectionTransactionConflictError({ cause: error })
          }
          throw error
        }),
    isConflict,
  )
}

function authorizationMatches(
  authorization: Awaited<ReturnType<typeof lockSensitiveAuthorization>>,
  input: Input,
): authorization is NonNullable<Awaited<ReturnType<typeof lockSensitiveAuthorization>>> {
  return (
    authorization !== null &&
    authorization.hubSessionId === input.hubSessionId &&
    authorization.operation === input.operation &&
    authorization.targetMembershipIds.length === 1 &&
    authorization.targetMembershipIds[0] === authorization.actorMembershipId
  )
}

async function lockCurrentAuthorization(transaction: Prisma.TransactionClient, input: Input) {
  const authorization = await lockSensitiveAuthorization(transaction, input.authorizationId)
  if (
    !authorizationMatches(authorization, input) ||
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
  return authorization
}

async function claimCheck(database: PrismaClientLike, input: Input) {
  try {
    await runSerializable(database, async (transaction) => {
      const authorization = await lockCurrentAuthorization(transaction, input)
      if (authorization.checkStartedAt) {
        throw new CopilotConnectionDeniedError("check_in_progress")
      }
      if (
        !(await isSensitiveAuthorizationCurrent(transaction, {
          authorizationId: input.authorizationId,
          hubSessionId: input.hubSessionId,
        }))
      ) {
        throw new CopilotConnectionDeniedError("authorization_unavailable")
      }
      if (
        !(await claimCopilotAuthorizationCheck(transaction, {
          id: input.authorizationId,
          maximumConcurrentChecks,
        }))
      ) {
        throw new CopilotConnectionUnavailableError(
          "Too many Copilot token checks are already running.",
        )
      }
    })
  } catch (error) {
    if (isConflict(error)) {
      await recordFailure(database, input, "retry_exhausted", "failure")
      throw new CopilotConnectionUnavailableError("The Copilot connection check could not start.", {
        cause: error,
      })
    }
    throw error
  }
}

async function applyConnectionChange(
  database: PrismaClientLike,
  input: Input,
  tokenDigest: string | undefined,
) {
  try {
    return await runSerializable(database, async (transaction) => {
      const authorization = await lockCurrentAuthorization(transaction, input)
      if (!authorization.checkStartedAt) {
        throw new CopilotConnectionDeniedError("authorization_unavailable")
      }
      if (
        !(await isSensitiveAuthorizationCurrent(transaction, {
          authorizationId: input.authorizationId,
          hubSessionId: input.hubSessionId,
        }))
      ) {
        throw new CopilotConnectionDeniedError("authorization_unavailable")
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
    })
  } catch (error) {
    if (isConflict(error)) {
      await recordFailure(database, input, "retry_exhausted", "failure")
      throw new CopilotConnectionUnavailableError(
        "The Copilot connection change could not be completed.",
        { cause: error },
      )
    }
    throw error
  }
}

async function finishCheck(database: PrismaClientLike, input: Input) {
  try {
    await runSerializable(database, async (transaction) => {
      if (!(await finishCopilotAuthorizationCheck(transaction, input.authorizationId))) {
        throw new CopilotConnectionDeniedError("authorization_unavailable")
      }
    })
  } catch (error) {
    if (isConflict(error)) {
      await recordFailure(database, input, "retry_exhausted", "failure")
      throw new CopilotConnectionUnavailableError(
        "The Copilot connection check could not release its capacity.",
        { cause: error },
      )
    }
    throw error
  }
}

async function recordFailure(
  database: PrismaClientLike,
  input: Input,
  reason: FailureReason,
  outcome: "denied" | "failure",
): Promise<
  | "authorization_unavailable"
  | "connection_changed"
  | "no_token"
  | "not_connected"
  | "refused"
  | "retry_exhausted"
  | "unavailable"
> {
  try {
    return await runSerializable(database, async (transaction) => {
      const authorization = await lockSensitiveAuthorization(transaction, input.authorizationId)
      if (
        !authorizationMatches(authorization, input) ||
        authorization.cancelledAt ||
        authorization.continuedAt
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
      if (authorization.checkStartedAt) {
        if (authorization.checkFinishedAt) {
          await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
        } else if (
          !(await finishCopilotAuthorizationWithFailure(transaction, input.authorizationId))
        ) {
          return "authorization_unavailable"
        }
      } else {
        await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
      }
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
        phase: authorization.expired ? "expired" : "denied",
        reason: recordedReason,
        targetCount: 1,
        type: "administrator_authorization",
      })
      return recordedReason
    })
  } catch (error) {
    if (isConflict(error)) {
      throw new CopilotConnectionUnavailableError(
        "The Copilot connection failure could not be recorded.",
        { cause: error },
      )
    }
    throw error
  }
}

export async function continueCopilotAuthorization(
  database: PrismaClientLike,
  rawInput: unknown,
  checkToken: (token: string) => Promise<void>,
) {
  const input = inputSchema.parse(rawInput)
  await claimCheck(database, input)

  let tokenDigest: string | undefined
  if (input.operation === "CONNECT_COPILOT") {
    if (!input.token) {
      await finishCheck(database, input)
      const reason = await recordFailure(database, input, "no_token", "denied")
      throw new CopilotConnectionDeniedError(
        reason === "retry_exhausted" || reason === "unavailable"
          ? "authorization_unavailable"
          : reason,
      )
    }
    let checkError: unknown
    try {
      await checkToken(input.token)
      tokenDigest = createHash("sha256").update(input.token).digest("hex")
    } catch (error) {
      checkError = error
    }
    await finishCheck(database, input)
    if (checkError) {
      const reason =
        checkError instanceof CopilotTokenCheckError && checkError.reason === "refused"
          ? "refused"
          : "unavailable"
      const recordedReason = await recordFailure(
        database,
        input,
        reason,
        reason === "refused" ? "denied" : "failure",
      )
      if (recordedReason !== "unavailable") {
        throw new CopilotConnectionDeniedError(
          recordedReason === "retry_exhausted" ? "authorization_unavailable" : recordedReason,
        )
      }
      throw new CopilotConnectionUnavailableError("Copilot could not check the configured token.", {
        cause: checkError,
      })
    }
  } else {
    await finishCheck(database, input)
  }

  try {
    return await applyConnectionChange(database, input, tokenDigest)
  } catch (error) {
    if (
      error instanceof CopilotConnectionDeniedError &&
      (error.reason === "connection_changed" ||
        error.reason === "not_connected" ||
        error.reason === "authorization_unavailable")
    ) {
      await recordFailure(database, input, error.reason, "denied")
    }
    throw error
  }
}
