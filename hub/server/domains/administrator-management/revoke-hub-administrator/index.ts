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
    targetMembershipId: z.uuid(),
  })
  .strict()

async function revokeWithinTransaction(
  repositories: AdministratorManagementRepositories,
  input: z.infer<typeof inputSchema>,
  createId: () => string,
) {
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
  return { assignmentId: assignment.id, membershipId: input.targetMembershipId }
}

export async function revokeHubAdministrator(
  rawInput: unknown,
  dependencies: AdministratorManagementDependencies,
) {
  const parsed = inputSchema.safeParse(rawInput)
  if (!parsed.success) throw new AdministratorManagementDeniedError("invalid_target")
  try {
    return await runWithBoundedRetries(
      () =>
        dependencies.runTransaction((repositories) =>
          revokeWithinTransaction(repositories, parsed.data, () => dependencies.createId()),
        ),
      (error) => error instanceof AdministratorManagementTransactionConflictError,
    )
  } catch (error) {
    if (error instanceof AdministratorManagementDeniedError) throw error
    throw new AdministratorManagementPersistenceError({ cause: error })
  }
}
