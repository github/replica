import type { AuthenticationDependencies } from "#server/domains/authentication/create-service/types"
import type { IdentityRecords } from "#server/domains/identity/create-store/types"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"

export async function getCurrentSession(
  dependencies: AuthenticationDependencies,
  sessionToken: string,
  records: Pick<IdentityRecords, "membership" | "session"> = dependencies.store.read,
) {
  const session = sessionToken ? await records.session(digestSecret(sessionToken)) : null
  if (!session) {
    throw new AuthenticationError(401, "sign_in_required", "Sign in to continue.")
  }
  const membership = await records.membership(session.userId)
  if (!membership || membership.status !== "active") {
    throw new AuthenticationError(401, "membership_inactive", "Sign in to continue.")
  }
  return { ...session, membership }
}
