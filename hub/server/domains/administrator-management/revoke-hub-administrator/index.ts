import { z } from "zod"

import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  AdministratorManagementDeniedError,
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "../errors.ts"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types.ts"
import type { AdministratorManagementDependencies } from "../types.ts"

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const inputSchema = z
  .object({
    actorMembershipId: uuidSchema,
    targetMembershipId: uuidSchema,
  })
  .strict()

async function revokeWithinTransaction(
  repositories: AdministratorManagementRepositories,
  input: z.infer<typeof inputSchema>,
  createId: () => string,
) {
  await repositories.lockEffectiveAdministratorProviders()
  const administrators = await repositories.lockEffectiveAdministrators()
  const administratorIds = new Set(administrators.map(({ membershipId }) => membershipId))
  if (!administratorIds.has(input.actorMembershipId)) {
    throw new AdministratorManagementDeniedError("not_authorized")
  }
  const targets = await repositories.lockTargets([input.targetMembershipId])
  const target = targets[0]
  if (
    !target ||
    target.membershipId !== input.targetMembershipId ||
    target.lifecycle !== "ACTIVE" ||
    !target.externalIdentityId
  ) {
    throw new AdministratorManagementDeniedError("invalid_target")
  }
  const assignment = await repositories.lockActiveAssignment(input.targetMembershipId)
  if (!assignment) throw new AdministratorManagementDeniedError("role_changed")

  await repositories.revokeAssignment(assignment.id)
  const remainingAdministrators = await repositories.lockEffectiveAdministrators()
  if (remainingAdministrators.length === 0) {
    throw new AdministratorManagementDeniedError("last_administrator")
  }
  await repositories.createSecurityAudit({
    actorMembershipId: input.actorMembershipId,
    assignmentId: assignment.id,
    id: createId(),
    targetMembershipId: input.targetMembershipId,
    type: "administrator_membership_assignment_revoked",
  })
  const endedSessions = await repositories.endOpenSessions(input.targetMembershipId)
  for (const session of endedSessions) {
    await repositories.createSecurityAudit({
      id: createId(),
      membershipId: input.targetMembershipId,
      sessionId: session.id,
      type: "session_ended",
    })
  }
  return { assignmentId: assignment.id, membershipId: input.targetMembershipId }
}

async function writeInvalidTargetAudit(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
  error: AdministratorManagementDeniedError,
) {
  const actor = z.object({ actorMembershipId: uuidSchema }).loose().safeParse(rawInput)
  try {
    await dependencies.writeAudit({
      actorMembershipId: actor.success ? actor.data.actorMembershipId : null,
      id: dependencies.createId(),
      operation: "revoke",
      reason: error.reason,
      type: "administrator_management_denied",
    })
  } catch (auditError) {
    throw new AggregateError(
      [error, auditError],
      "The administrator revocation denial and its audit could not both be recorded.",
      { cause: auditError },
    )
  }
}

export async function revokeHubAdministrator(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
) {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) {
    const error = new AdministratorManagementDeniedError("invalid_target")
    await writeInvalidTargetAudit(rawInput, dependencies, error)
    throw error
  }
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          revokeWithinTransaction(repositories, parsed.data, () => dependencies.createId()),
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
              operation: "revoke",
              reason: error.reason,
              type: "administrator_management_denied",
            }
          : {
              actorMembershipId: parsed.data.actorMembershipId,
              id: dependencies.createId(),
              operation: "revoke",
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
        "The administrator revocation failure and its audit could not both be recorded.",
        { cause: auditError },
      )
    }
    throw primary
  }
}
