import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"
import { disconnectCopilotConnectionForMemberships } from "../../../repositories/copilot-connection-state/disconnect-copilot-connection-for-memberships/index.ts"
import { endOpenHubSessionsForMemberships } from "../../../repositories/hub-sessions/end-open-hub-sessions-for-memberships/index.ts"
import { lockEffectiveAdministratorAssignments } from "../../../repositories/membership-assignments/lock-effective-administrator-assignments/index.ts"
import { revokeActiveProviderAssignments } from "../../../repositories/membership-assignments/revoke-active-provider-assignments/index.ts"
import { listGitHubMembershipIdentities } from "../../../repositories/memberships/list-github-membership-identities/index.ts"
import { lockMembershipsById } from "../../../repositories/memberships/lock-memberships-by-id/index.ts"
import { claimProviderRevocationEvidence } from "../../../repositories/provider-evidence-states/claim-provider-revocation-evidence/index.ts"
import { createSecurityAudits } from "../../../repositories/security-audits/create-security-audits/index.ts"
import type { CreateSecurityAuditEvent } from "../../../repositories/security-audits/create-security-audit/types.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"

/**
 * Removes GitHub provider authority from memberships that lost their last repository.
 * Every step is one set-based statement, so the work stays bounded for a whole installation.
 */
export async function revokeEmptyGitHubRepositoryAccess(
  transaction: Prisma.TransactionClient,
  input: { changedAt: Date; membershipIds: string[] },
) {
  const memberships = await listGitHubMembershipIdentities(transaction, input.membershipIds)
  const identityIds = memberships.flatMap((membership) =>
    membership.user.externalIdentities.map((identity) => identity.id),
  )
  if (!identityIds.length) return
  const claim = await claimProviderRevocationEvidence(transaction, {
    externalIdentityIds: identityIds,
    issuedAt: input.changedAt,
  })
  if (claim === "conflict") throw new AdmissionTransactionConflictError()
  if (claim === "stale") throw new Error("GitHub repository revocation evidence did not advance.")
  const locked = await lockMembershipsById(
    transaction,
    memberships.map((membership) => membership.id),
  )
  const revoked = await revokeActiveProviderAssignments(transaction, identityIds)
  if (!revoked.length) return
  const revokedMembershipIds = [...new Set(revoked.map((assignment) => assignment.membershipId))]
  const administrators = new Set(
    (await lockEffectiveAdministratorAssignments(transaction, revokedMembershipIds)).map(
      (assignment) => assignment.membershipId,
    ),
  )
  const active = new Set(
    locked.filter((membership) => membership.lifecycle === "ACTIVE").map(({ id }) => id),
  )
  const withoutAccess = revokedMembershipIds.filter(
    (id) => active.has(id) && !administrators.has(id),
  )
  const audits: CreateSecurityAuditEvent[] = revoked.map((assignment) => ({
    assignmentId: assignment.id,
    id: randomUUID(),
    membershipId: assignment.membershipId,
    role: assignment.role,
    type: "provider_membership_assignment_revoked",
  }))
  const disconnected = await disconnectCopilotConnectionForMemberships(transaction, withoutAccess)
  if (disconnected) {
    audits.push({
      actorMembershipId: null,
      connectionId: disconnected.connectionId,
      credentialProvider: disconnected.credentialProvider,
      id: randomUUID(),
      phase: "disconnected",
      reason: "connector_role_removed",
      type: "copilot_connection",
    })
  }
  const endedSessions = await endOpenHubSessionsForMemberships(transaction, {
    membershipIds: revokedMembershipIds,
    noRepositoryAccessMembershipIds: withoutAccess,
  })
  for (const session of endedSessions) {
    audits.push({
      id: randomUUID(),
      membershipId: session.membershipId,
      sessionId: session.id,
      type: "session_ended",
    })
  }
  await createSecurityAudits(transaction, audits)
}
