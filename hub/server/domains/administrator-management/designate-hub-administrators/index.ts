import { z } from "zod"

import { runWithBoundedRetries } from "../../identity/run-with-bounded-retries/index.ts"
import {
  AdministratorManagementDeniedError,
  AdministratorManagementPersistenceError,
  AdministratorManagementTransactionConflictError,
} from "../errors.ts"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types.ts"
import type { AdministratorManagementDependencies } from "../types.ts"

const inputSchema = z
  .object({
    actorMembershipId: z.uuid(),
    targetMembershipIds: z.array(z.uuid()).min(1).max(50),
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
    assignments.push({ assignmentId: assignment.id, membershipId })
  }
  return assignments
}

export async function designateHubAdministrators(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
) {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) throw new AdministratorManagementDeniedError("invalid_selection")
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          designateWithinTransaction(repositories, parsed.data, () => dependencies.createId()),
        ),
      (error) => error instanceof AdministratorManagementTransactionConflictError,
    )
  } catch (error) {
    if (error instanceof AdministratorManagementDeniedError) throw error
    throw new AdministratorManagementPersistenceError({ cause: error })
  }
}
