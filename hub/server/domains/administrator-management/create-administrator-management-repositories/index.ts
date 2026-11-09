import type { Prisma } from "../../../generated/prisma/client.ts"

import { lockEffectiveAdministratorProviders } from "../../../repositories/authentication-providers/lock-effective-administrator-providers/index.ts"
import { endOpenHubSessionsForMembership } from "../../../repositories/hub-sessions/end-open-hub-sessions-for-membership/index.ts"
import { createAdministratorAssignment } from "../../../repositories/membership-assignments/create-administrator-assignment/index.ts"
import { lockActiveAdministratorAssignment } from "../../../repositories/membership-assignments/lock-active-administrator-assignment/index.ts"
import { lockEffectiveAdministratorAssignments } from "../../../repositories/membership-assignments/lock-effective-administrator-assignments/index.ts"
import { revokeAdministratorAssignment } from "../../../repositories/membership-assignments/revoke-administrator-assignment/index.ts"
import { lockAdministratorManagementTargets } from "../../../repositories/memberships/lock-administrator-management-targets/index.ts"
import { lockEffectiveAdministrators } from "../../../repositories/memberships/lock-effective-administrators/index.ts"
import { createSecurityAudit } from "../../../repositories/security-audits/create-security-audit/index.ts"
import type { AdministratorManagementRepositories } from "../run-administrator-management-transaction/types.ts"

export function createAdministratorManagementRepositories(
  transaction: Prisma.TransactionClient,
): AdministratorManagementRepositories {
  return {
    createAssignment: (input) => createAdministratorAssignment(transaction, input),
    createSecurityAudit: (input) => createSecurityAudit(transaction, input),
    endOpenSessions: (membershipId) => endOpenHubSessionsForMembership(transaction, membershipId),
    lockActiveAssignment: (membershipId) =>
      lockActiveAdministratorAssignment(transaction, membershipId),
    lockEffectiveAdministratorAssignments: (membershipIds) =>
      lockEffectiveAdministratorAssignments(transaction, membershipIds),
    lockEffectiveAdministratorProviders: () => lockEffectiveAdministratorProviders(transaction),
    lockEffectiveAdministrators: () => lockEffectiveAdministrators(transaction),
    lockTargets: (membershipIds) => lockAdministratorManagementTargets(transaction, membershipIds),
    revokeAssignment: (id) => revokeAdministratorAssignment(transaction, id),
  }
}
