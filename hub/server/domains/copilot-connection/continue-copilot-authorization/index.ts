import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Prisma } from "../../../generated/prisma/client.ts"

import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import { claimCopilotAuthorizationCheck } from "../../../repositories/sensitive-authorizations/claim-copilot-authorization-check/index.ts"
import { finishCopilotAuthorizationCheck } from "../../../repositories/sensitive-authorizations/finish-copilot-authorization-check/index.ts"
import { getSensitiveAuthorizationAuditData } from "../../../repositories/sensitive-authorizations/get-sensitive-authorization-audit-data/index.ts"
import { markSensitiveAuthorizationContinued } from "../../../repositories/sensitive-authorizations/mark-sensitive-authorization-continued/index.ts"
import { CopilotConnectionError } from "../errors.ts"

const maximumConcurrentChecks = 4
const inputSchema = z.object({
  authorizationId: z.uuid(),
  hubSessionId: z.uuid(),
  operation: z.enum(["CONNECT_COPILOT", "DISCONNECT_COPILOT"]),
})

interface Database {
  $transaction<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result>
}

export async function continueCopilotAuthorization(
  database: Database,
  rawInput: unknown,
  mutate: (input: {
    authorizationId: string
    hubSessionId: string
    operation: "CONNECT_COPILOT" | "DISCONNECT_COPILOT"
  }) => Promise<unknown>,
) {
  const input = inputSchema.parse(rawInput)
  const claimed = await database.$transaction((transaction) =>
    claimCopilotAuthorizationCheck(transaction, {
      id: input.authorizationId,
      hubSessionId: input.hubSessionId,
      maximumConcurrentChecks,
      operation: input.operation,
    }),
  )
  if (!claimed) {
    throw new CopilotConnectionError(
      "connection_changed",
      "The Copilot authorization is no longer available.",
    )
  }
  try {
    return await mutate(input)
  } catch (error) {
    await database.$transaction(async (transaction) => {
      await finishCopilotAuthorizationCheck(transaction, input.authorizationId)
      const authorization = await getSensitiveAuthorizationAuditData(
        transaction,
        input.authorizationId,
      )
      if (!authorization || authorization.continued) return
      await markSensitiveAuthorizationContinued(transaction, input.authorizationId)
      await createSecurityAudit(transaction, {
        actorMembershipId: authorization.actorMembershipId,
        authorizationId: input.authorizationId,
        id: randomUUID(),
        operation: authorization.operation,
        phase: authorization.expired ? "expired" : "denied",
        reason: error instanceof CopilotConnectionError ? error.code : "transaction_error",
        targetCount: authorization.targetCount,
        type: "administrator_authorization",
      })
    })
    throw error
  } finally {
    await database
      .$transaction((transaction) =>
        finishCopilotAuthorizationCheck(transaction, input.authorizationId),
      )
      .catch(() => undefined)
  }
}
