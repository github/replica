import { AdministratorManagementDeniedError } from "../errors.ts"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types.ts"

export async function designateHubAdministratorsWithRepositories(
  repositories: AdministratorManagementRepositories,
  input: { actorMembershipId: string; targetMembershipIds: string[] },
  createId: () => string,
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
