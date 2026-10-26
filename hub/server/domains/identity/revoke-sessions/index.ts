import { requireIdentityAdministrator } from "#server/domains/identity/require-identity-administrator"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function revokeSessions(
  dependencies: IdentityDependencies,
  token: string,
  csrfToken: string,
  confirmed: boolean,
) {
  const { store } = dependencies

  await store.lock(async (records) => {
    const current = await requireIdentityAdministrator(dependencies, token, csrfToken, records)
    if (!confirmed) {
      throw new IdentityError(
        400,
        "confirmation_required",
        "Confirm that all Hub sessions, including this session, will end.",
      )
    }
    await records.advanceGeneration()
    await records.deleteSessions()
    await records.audit({
      event: "session.revoke_all",
      actorId: current.user.id,
      sessionId: current.session.id,
    })
  })
}
