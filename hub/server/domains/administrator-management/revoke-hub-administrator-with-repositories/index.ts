import { AdministratorManagementDeniedError } from "../errors.ts"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types.ts"

export async function revokeHubAdministratorWithRepositories(
  repositories: AdministratorManagementRepositories,
  input: { actorMembershipId: string; targetMembershipId: string },
  createId: () => string,
  validateAfterAuthorityLocks?: () => Promise<void>,
) {
  await repositories.lockEffectiveAdministratorProviders()
  const administrators = await repositories.lockEffectiveAdministrators()
  await repositories.lockEffectiveAdministratorAssignments(
    administrators.map(({ membershipId }) => membershipId),
  )
  const administratorIds = new Set(administrators.map(({ membershipId }) => membershipId))
  if (!administratorIds.has(input.actorMembershipId)) {
    throw new AdministratorManagementDeniedError("not_authorized")
  }
  await validateAfterAuthorityLocks?.()
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
  if (
    !remainingAdministrators.some(
      ({ membershipId }) => membershipId === input.targetMembershipId,
    ) &&
    (await repositories.disconnectCopilotConnection?.(input.targetMembershipId))
  ) {
    await repositories.createSecurityAudit({
      actorMembershipId: input.actorMembershipId,
      id: createId(),
      operation: "disconnect",
      outcome: "success",
      reason: "connector_role_removed",
      type: "copilot_connection",
    })
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
