import { randomUUID } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client.ts"
import { advanceGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/advance-github-repository-access-state/index.ts"
import { lockGitHubRepositoryAccessState } from "../../../repositories/github-repository-access-states/lock-github-repository-access-state/index.ts"
import { endOpenGitHubSessions } from "../../../repositories/hub-sessions/end-open-github-sessions/index.ts"
import { listOpenGitHubSessionMemberships } from "../../../repositories/hub-sessions/list-open-github-session-memberships/index.ts"
import { lockEffectiveAdministratorAssignments } from "../../../repositories/membership-assignments/lock-effective-administrator-assignments/index.ts"
import { lockMembershipsById } from "../../../repositories/memberships/lock-memberships-by-id/index.ts"
import { createSecurityAudits } from "../../../repositories/security-audits/create-security-audits/index.ts"
import { lockSessionRevocationStateForUpdate } from "../../../repositories/session-revocation-states/lock-session-revocation-state-for-update/index.ts"

export async function activateGitHubRepositoryScoping(transaction: Prisma.TransactionClient) {
  if (!(await lockSessionRevocationStateForUpdate(transaction))) {
    throw new Error("The global session revocation authority is unavailable.")
  }
  const access = await lockGitHubRepositoryAccessState(transaction, "write")
  if (access.scopingActivatedAt) return

  const candidates = await listOpenGitHubSessionMemberships(transaction)
  const memberships = await lockMembershipsById(
    transaction,
    candidates.map(({ membershipId }) => membershipId),
  )
  const administrators = new Set(
    (
      await lockEffectiveAdministratorAssignments(
        transaction,
        memberships.map(({ id }) => id),
      )
    ).map(({ membershipId }) => membershipId),
  )
  const sessions = await endOpenGitHubSessions(
    transaction,
    memberships.filter(({ id }) => !administrators.has(id)).map(({ id }) => id),
  )
  await createSecurityAudits(
    transaction,
    sessions.map((session) => ({
      id: randomUUID(),
      membershipId: session.membershipId,
      sessionId: session.id,
      type: "session_ended",
    })),
  )
  await advanceGitHubRepositoryAccessState(transaction, { activateScoping: true })
}
