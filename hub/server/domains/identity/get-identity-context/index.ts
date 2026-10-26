import { createCsrfToken } from "#server/utils/create-csrf-token"
import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityContext, IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function getIdentityContext(
  dependencies: IdentityDependencies,
  token: string,
  records = dependencies.store.read,
): Promise<IdentityContext> {
  const session = await records.session(digestSecret(token))
  if (!token || !session) {
    throw new IdentityError(401, "sign_in_required", "Sign in to Hub.")
  }
  return { user: session.user, session, csrfToken: createCsrfToken(token) }
}
