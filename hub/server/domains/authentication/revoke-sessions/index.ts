import type { AuthenticationDependencies } from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { AuthenticationError } from "#server/utils/authentication-error"

const freshAuthorizationMilliseconds = 10 * 60_000

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
    if (
      !current.freshAuthorizedAt ||
      now().getTime() - current.freshAuthorizedAt.getTime() > freshAuthorizationMilliseconds
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
      actorUserId: current.userId,
      sessionId: current.id,
      authenticationProviderRevisionId: current.authenticationProviderRevisionId,
    })
  })
}
