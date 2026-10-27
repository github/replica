import { randomBytes } from "node:crypto"

import type {
  AuthenticationDependencies,
  AuthorizationPurpose,
} from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"
import { secretsMatch } from "#server/utils/secrets-match"

export async function startGitHubAuthorization(
  dependencies: AuthenticationDependencies,
  purpose: AuthorizationPurpose,
  sessionToken?: string,
  enrollmentSecret?: string,
) {
  const { bootstrapSecret, configuration, github, now, providerRevisionId, recoverySecret, store } =
    dependencies
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
    if (purpose === "bootstrap") {
      if (
        (await records.bootstrapCompletedAt()) ||
        !bootstrapSecret ||
        !enrollmentSecret ||
        !secretsMatch(digestSecret(enrollmentSecret), digestSecret(bootstrapSecret))
      ) {
        throw new AuthenticationError(404, "bootstrap_unavailable", "Enrollment is unavailable.")
      }
    }
    if (purpose === "recovery") {
      if (
        !recoverySecret ||
        !enrollmentSecret ||
        !secretsMatch(digestSecret(enrollmentSecret), digestSecret(recoverySecret)) ||
        (await records.activeAdministratorCount()) > 0
      ) {
        throw new AuthenticationError(404, "recovery_unavailable", "Recovery is unavailable.")
      }
    }
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
