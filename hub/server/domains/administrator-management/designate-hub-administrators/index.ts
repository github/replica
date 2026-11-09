import { z } from "zod"

import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  AdministratorManagementDeniedError,
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "../errors.ts"
import { designateHubAdministratorsWithRepositories } from "../designate-hub-administrators-with-repositories/index.ts"
import type { AdministratorManagementDependencies } from "../types.ts"

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const inputSchema = z
  .object({
    actorMembershipId: uuidSchema,
    targetMembershipIds: z.array(uuidSchema).min(1).max(50),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.targetMembershipIds).size !== input.targetMembershipIds.length) {
      context.addIssue({ code: "custom", message: "Target memberships must be unique." })
    }
  })

async function writeInvalidSelectionAudit(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
  error: AdministratorManagementDeniedError,
) {
  const actor = z.object({ actorMembershipId: uuidSchema }).loose().safeParse(rawInput)
  try {
    await dependencies.writeAudit({
      actorMembershipId: actor.success ? actor.data.actorMembershipId : null,
      id: dependencies.createId(),
      operation: "designate",
      reason: error.reason,
      type: "administrator_management_denied",
    })
  } catch (auditError) {
    throw new AggregateError(
      [error, auditError],
      "The administrator designation denial and its audit could not both be recorded.",
      { cause: auditError },
    )
  }
}

export async function designateHubAdministrators(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
) {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) {
    const error = new AdministratorManagementDeniedError("invalid_selection")
    await writeInvalidSelectionAudit(rawInput, dependencies, error)
    throw error
  }
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          designateHubAdministratorsWithRepositories(repositories, parsed.data, () =>
            dependencies.createId(),
          ),
        ),
      (error) => error instanceof AdministratorManagementTransactionConflictError,
    )
  } catch (error) {
    const denial = error instanceof AdministratorManagementDeniedError
    const primary = denial ? error : new AdministratorManagementPersistenceError({ cause: error })
    try {
      await dependencies.writeAudit(
        denial
          ? {
              actorMembershipId: parsed.data.actorMembershipId,
              id: dependencies.createId(),
              operation: "designate",
              reason: error.reason,
              type: "administrator_management_denied",
            }
          : {
              actorMembershipId: parsed.data.actorMembershipId,
              id: dependencies.createId(),
              operation: "designate",
              reason:
                error instanceof AdministratorManagementTransactionConflictError
                  ? "retry_exhausted"
                  : "transaction_error",
              type: "administrator_management_failed",
            },
      )
    } catch (auditError) {
      throw new AggregateError(
        [primary, auditError],
        "The administrator designation failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw primary
  }
}
