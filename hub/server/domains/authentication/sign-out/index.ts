import type { AuthenticationDependencies } from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"

export async function signOut(
  dependencies: AuthenticationDependencies,
  sessionToken: string,
): Promise<void> {
  await dependencies.store.lock(async (records) => {
    const current = await getCurrentSession(dependencies, sessionToken, records)
    await records.deleteSession(current.id)
    await records.audit({
      event: "session.sign_out",
      actorUserId: current.userId,
      sessionId: current.id,
      authenticationProviderRevisionId: current.authenticationProviderRevisionId,
    })
  })
}
