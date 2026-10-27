import { randomBytes } from "node:crypto"

import type {
  AuthenticationDependencies,
  AuthorizationPurpose,
} from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"

export async function startGitHubAuthorization(
  dependencies: AuthenticationDependencies,
  purpose: AuthorizationPurpose,
  sessionToken?: string,
) {
  const { configuration, github, now, providerRevisionId, store } = dependencies
  if (!configuration || !github || !providerRevisionId) {
    throw new AuthenticationError(
      503,
      "authentication_unconfigured",
      "GitHub authentication is not configured.",
    )
  }
  const state = randomBytes(32).toString("base64url")
  const browserToken = randomBytes(32).toString("base64url")
  const pkceVerifier = randomBytes(32).toString("base64url")
  await store.lock(async (records) => {
    const provider = await records.currentAuthenticationProviderRevision("github")
    if (provider?.id !== providerRevisionId) {
      throw new AuthenticationError(
        409,
        "provider_changed",
        "GitHub authentication changed. Start again.",
      )
    }
    const session =
      purpose === "verify"
        ? await getCurrentSession(dependencies, sessionToken ?? "", records)
        : null
    const stateRecord = await records.identityStoreState()
    await records.createAuthorizationAttempt({
      authenticationProviderRevisionId: providerRevisionId,
      originatingSessionId: session?.id ?? null,
      stateDigest: digestSecret(state),
      browserDigest: digestSecret(browserToken),
      pkceVerifier,
      nonce: null,
      purpose,
      sessionGeneration: stateRecord.sessionGeneration,
      expiresAt: new Date(now().getTime() + 10 * 60_000),
    })
  })
  return {
    authorizationUrl: github.authorizationUrl(state, pkceVerifier),
    browserToken,
  }
}
