import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

export async function signOut(
  dependencies: IdentityDependencies,
  token: string,
  csrfToken: string,
) {
  const { store } = dependencies

  requireCsrfToken(token, csrfToken)
  await store.lock(async (records) => {
    const current = await getIdentityContext(dependencies, token, records)
    await records.deleteSession(current.session.id)
    await records.audit({
      event: "session.sign_out",
      actorId: current.user.id,
      sessionId: current.session.id,
    })
  })
}
