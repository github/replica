import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"

export async function recordIdentityDenial(
  dependencies: IdentityDependencies,
  token: string,
  code: string,
) {
  const { store } = dependencies

  await store.lock(async (records) => {
    const session = token ? await records.session(digestSecret(token)) : null
    await records.audit({
      event: `identity.denied.${code}`,
      actorId: session?.userId ?? null,
      sessionId: session?.id ?? null,
    })
  })
}
