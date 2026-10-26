import { randomBytes } from "node:crypto"

import { getIdentityConfiguration } from "#server/domains/identity/get-identity-configuration"
import { getIdentityContext } from "#server/domains/identity/get-identity-context"
import { requireBootstrapSecret } from "#server/domains/identity/require-bootstrap-secret"
import { digestSecret } from "#server/utils/digest-secret"
import type { IdentityDependencies, IdentityService } from "#server/utils/identity-contracts/types"
import { IdentityError } from "#server/utils/identity-error"
import { requireCsrfToken } from "#server/utils/require-csrf-token"

export async function startGitHubAuthorization(
  dependencies: IdentityDependencies,
  input: Parameters<IdentityService["start"]>[0],
) {
  const { purpose, token, csrfToken, bootstrapSecret } = input
  const { store, github, now, settings } = dependencies

  if (!settings.signInProviders.includes("github")) {
    throw new IdentityError(409, "provider_disabled", "GitHub sign-in is not enabled.")
  }
  if (purpose === "enroll") requireBootstrapSecret(dependencies, bootstrapSecret)
  if (purpose === "verify") requireCsrfToken(token ?? "", csrfToken ?? "")
  const state = randomBytes(32).toString("base64url")
  const browserToken = randomBytes(32).toString("base64url")
  const verifier = randomBytes(32).toString("base64url")
  const url = await store.lock(async (records) => {
    if (purpose === "enroll" && (await records.administrator())) {
      throw new IdentityError(
        409,
        "administrator_already_enrolled",
        "Bootstrap administrator enrollment has already been used.",
      )
    }
    const configuration = await getIdentityConfiguration(dependencies, records)
    const session =
      purpose === "verify" ? await getIdentityContext(dependencies, token ?? "", records) : null
    await records.createAttempt({
      stateDigest: digestSecret(state),
      browserDigest: digestSecret(browserToken),
      verifier,
      purpose,
      sessionId: session?.session.id ?? null,
      generation: configuration.state.generation,
      credentialRevision: configuration.revision,
      expiresAt: new Date(now().getTime() + 15 * 60_000),
    })
    return github.authorize(configuration.credentials, state, verifier)
  })
  return { url, browserToken }
}
