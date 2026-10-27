import type { AuthenticationDependencies } from "#server/domains/authentication/create-service/types"
import { administratorFreshAuthorizationLifetimeMilliseconds } from "#server/domains/authentication/fresh-authorization/constants"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { AuthenticationError } from "#server/utils/authentication-error"

export async function revokeSessions(
  dependencies: AuthenticationDependencies,
  sessionToken: string,
): Promise<void> {
  const { now, store } = dependencies
  await store.lock(async (records) => {
    const current = await getCurrentSession(dependencies, sessionToken, records)
    if (current.membership?.status !== "active" || current.membership.role !== "administrator") {
      throw new AuthenticationError(403, "administrator_required", "Administrator access required.")
    }
    const freshAuthorizationAge = current.freshAuthorizedAt
      ? now().getTime() - current.freshAuthorizedAt.getTime()
      : null
    if (
      freshAuthorizationAge === null ||
      freshAuthorizationAge < 0 ||
      freshAuthorizationAge >= administratorFreshAuthorizationLifetimeMilliseconds
    ) {
      throw new AuthenticationError(
        403,
        "fresh_authorization_required",
        "Fresh authorization required.",
      )
    }
    await records.advanceSessionGeneration()
    await records.deleteSessions()
    await records.audit({
      event: "session.revoke_all",
      outcome: "succeeded",
      actorUserId: current.userId,
      sessionId: current.id,
      authenticationProviderRevisionId: current.authenticationProviderRevisionId,
    })
  })
}
