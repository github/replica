import { timingSafeEqual } from "node:crypto"

import { finishGitHubAuthorization } from "#server/domains/identity/finish-github-authorization"
import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"

export async function completeGitHubAuthorization(
  dependencies: IdentityDependencies,
  code: string,
  state: string,
  browserToken: string,
) {
  const { store, github, now } = dependencies

  const attempt = await store.lock((records) => records.consumeAttempt(digestSecret(state)))
  if (
    !attempt ||
    attempt.expiresAt <= now() ||
    !timingSafeEqual(Buffer.from(digestSecret(browserToken)), Buffer.from(attempt.browserDigest))
  ) {
    throw new IdentityError(
      401,
      "invalid_oauth_state",
      "This GitHub sign-in expired or does not belong to this browser. Start again.",
    )
  }
  const configuration = await getIdentityConfiguration(dependencies)
  if (
    attempt.credentialRevision !== configuration.revision ||
    attempt.generation !== configuration.state.generation
  ) {
    throw new IdentityError(
      401,
      "sign_in_cancelled",
      "Hub credentials or sessions changed. Start a new sign-in.",
    )
  }
  const profile = await github.identify(configuration.credentials, code, attempt.verifier)
  const verifiedAt = now()
  const existingUser = await store.read.githubUser(profile.providerId)
  const admitted =
    attempt.purpose === "sign-in" && !existingUser?.administrator
      ? await github.admitted(configuration.credentials, profile)
      : false
  return store.lock(
    finishGitHubAuthorization.bind(null, dependencies, { attempt, profile, verifiedAt, admitted }),
  )
}
