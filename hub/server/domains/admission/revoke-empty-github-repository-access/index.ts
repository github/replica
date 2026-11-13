import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"
import { listGitHubMembershipIdentities } from "../../../repositories/memberships/list-github-membership-identities/index.ts"
import { claimProviderEvidence } from "../../../repositories/provider-evidence-states/claim-provider-evidence/index.ts"
import { applyProviderAssignmentEvidence } from "../apply-provider-assignment-evidence/index.ts"
import { createAdmissionRepositories } from "../create-admission-repositories/index.ts"
import { AdmissionTransactionConflictError } from "../errors.ts"

export async function revokeEmptyGitHubRepositoryAccess(
  transaction: Prisma.TransactionClient,
  input: { changedAt: Date; membershipIds: string[] },
) {
  const memberships = await listGitHubMembershipIdentities(transaction, input.membershipIds)
  const repositories = createAdmissionRepositories(transaction)
  for (const membership of memberships) {
    let revoked = false
    for (const identity of membership.user.externalIdentities) {
      const claim = await claimProviderEvidence(transaction, {
        externalIdentityId: identity.id,
        id: randomUUID(),
        issuedAt: input.changedAt,
        role: null,
      })
      if (claim === "conflict") throw new AdmissionTransactionConflictError()
      if (claim === "stale") {
        throw new Error("GitHub repository revocation evidence did not advance.")
      }
      await repositories.lockMembership(identity.userId)
      const active = await repositories.lockActiveProviderAssignment(identity.id)
      if (!active) continue
      revoked = true
      await applyProviderAssignmentEvidence(
        {
          assignmentSubject: null,
          externalIdentityId: identity.id,
          providerRevisionId: active.providerRevisionId,
          role: null,
          userId: identity.userId,
        },
        { createId: randomUUID, deferSessionEnd: true, repositories },
      )
    }
    if (!revoked) continue
    const assignments = await repositories.lockActiveAssignments(membership.id)
    const endedSessions =
      membership.lifecycle === "ACTIVE" &&
      !assignments.some((assignment) => assignment.role === "ADMINISTRATOR")
        ? await repositories.endOpenHubSessionsForMembership(
            membership.id,
            "GITHUB_REPOSITORY_ACCESS_REVOKED",
          )
        : await repositories.endOpenHubSessionsForMembership(membership.id)
    for (const session of endedSessions) {
      await repositories.createSecurityAudit({
        id: randomUUID(),
        type: "session_ended",
        sessionId: session.id,
        membershipId: membership.id,
      })
    }
  }
}
