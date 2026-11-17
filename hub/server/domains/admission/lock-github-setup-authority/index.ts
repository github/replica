import type { Prisma } from "../../../generated/prisma/client.ts"
import { lockAuthenticationProvidersForPrototypeEdit } from "../../../repositories/authentication-providers/lock-authentication-providers-for-prototype-edit/index.ts"
import { lockAdministratorHubSession } from "../../../repositories/hub-sessions/lock-administrator-hub-session/index.ts"
import { countEffectiveAdministrators } from "../../../repositories/memberships/count-effective-administrators/index.ts"
import { lockSessionRevocationState } from "../../../repositories/session-revocation-states/lock-session-revocation-state/index.ts"

/**
 * Rechecks GitHub setup authority inside a write transaction. Locks providers in key order and
 * then the global revocation row, matching admission and session restoration.
 */
export async function lockGitHubSetupAuthority(
  transaction: Prisma.TransactionClient,
  caller: { membershipId: string | null; sessionDigest?: string },
): Promise<boolean> {
  await lockAuthenticationProvidersForPrototypeEdit(transaction)
  if (!(await lockSessionRevocationState(transaction))) return false
  if (caller.membershipId === null) return (await countEffectiveAdministrators(transaction)) === 0
  if (!caller.sessionDigest) return false
  const session = await lockAdministratorHubSession(transaction, caller.sessionDigest)
  return session?.membershipId === caller.membershipId
}
