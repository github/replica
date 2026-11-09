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
    targetMembershipIds: z.array(uuidSchema).min(1).max(50),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.targetMembershipIds).size !== input.targetMembershipIds.length) {
      context.addIssue({ code: "custom", message: "Target memberships must be unique." })
    }
  })

async function designateWithinTransaction(
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
  if (input.targetMembershipIds.some((membershipId) => administratorIds.has(membershipId))) {
    throw new AdministratorManagementDeniedError("role_changed")
  }
  const targets = await repositories.lockTargets(input.targetMembershipIds)
  const targetsById = new Map(targets.map((target) => [target.membershipId, target]))
  if (
    targets.length !== input.targetMembershipIds.length ||
    input.targetMembershipIds.some((membershipId) => {
      const target = targetsById.get(membershipId)
      return !target || target.lifecycle !== "ACTIVE" || !target.externalIdentityId
    })
  ) {
    throw new AdministratorManagementDeniedError("invalid_target")
  }

  const assignments = []
  for (const membershipId of input.targetMembershipIds) {
    const target = targetsById.get(membershipId)!
    const assignment = await repositories.createAssignment({
      externalIdentityId: target.externalIdentityId!,
      id: createId(),
      membershipId,
    })
    await repositories.createSecurityAudit({
      actorMembershipId: input.actorMembershipId,
      assignmentId: assignment.id,
      id: createId(),
      targetMembershipId: membershipId,
      type: "administrator_membership_assignment_created",
    })
    const endedSessions = await repositories.endOpenSessions(membershipId)
    for (const session of endedSessions) {
      await repositories.createSecurityAudit({
        id: createId(),
        membershipId,
        sessionId: session.id,
        type: "session_ended",
      })
    }
    assignments.push({ assignmentId: assignment.id, membershipId })
  }
  return assignments
}

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
          designateWithinTransaction(repositories, parsed.data, () => dependencies.createId()),
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
