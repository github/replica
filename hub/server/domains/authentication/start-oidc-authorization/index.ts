import { randomBytes } from "node:crypto"

import type {
  AuthenticationDependencies,
  AuthorizationPurpose,
} from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"
import { secretsMatch } from "#server/utils/secrets-match"

export async function startOidcAuthorization(
  dependencies: AuthenticationDependencies,
  purpose: AuthorizationPurpose,
  sessionToken?: string,
  enrollmentSecret?: string,
) {
  const {
    bootstrapSecret,
    now,
    oidc,
    oidcConfiguration,
    oidcProviderRevisionId,
    recoverySecret,
    store,
  } = dependencies
  if (!oidcConfiguration?.enabled || !oidc || !oidcProviderRevisionId) {
    throw new AuthenticationError(
      503,
      "authentication_unconfigured",
      "OIDC authentication is not configured.",
    )
  }
  const state = randomBytes(32).toString("base64url")
  const browserToken = randomBytes(32).toString("base64url")
  const pkceVerifier = randomBytes(32).toString("base64url")
  const nonce = randomBytes(32).toString("base64url")
  const denial = await store.lock(async (records) => {
    const provider = await records.currentAuthenticationProviderRevision("oidc")
    if (provider?.id !== oidcProviderRevisionId) {
      throw new AuthenticationError(
        409,
        "provider_changed",
        "OIDC authentication changed. Start again.",
      )
    }
    const session =
      purpose === "verify"
        ? await getCurrentSession(dependencies, sessionToken ?? "", records)
        : null
    const stateRecord = await records.identityStoreState()
    if (purpose === "bootstrap") {
      const reason = (await records.bootstrapCompletedAt())
        ? "already_completed"
        : !bootstrapSecret
          ? "secret_unconfigured"
          : !enrollmentSecret
            ? "secret_missing"
            : !secretsMatch(digestSecret(enrollmentSecret), digestSecret(bootstrapSecret))
              ? "secret_mismatch"
              : null
      if (reason) {
        await records.audit({
          event: "membership.bootstrap",
          outcome: "denied",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: oidcProviderRevisionId,
          context: { reason },
        })
        return new AuthenticationError(404, "bootstrap_unavailable", "Enrollment is unavailable.")
      }
    }
    if (purpose === "recovery") {
      const reason = !recoverySecret
        ? "secret_unconfigured"
        : !enrollmentSecret
          ? "secret_missing"
          : !secretsMatch(digestSecret(enrollmentSecret), digestSecret(recoverySecret))
            ? "secret_mismatch"
            : (await records.activeAdministratorCount()) > 0
              ? "active_administrator_exists"
              : null
      if (reason) {
        await records.audit({
          event: "membership.recovery",
          outcome: "denied",
          actorUserId: null,
          sessionId: null,
          authenticationProviderRevisionId: oidcProviderRevisionId,
          context: { reason },
        })
        return new AuthenticationError(404, "recovery_unavailable", "Recovery is unavailable.")
      }
    }
    await records.createAuthorizationAttempt({
      authenticationProviderRevisionId: oidcProviderRevisionId,
      originatingSessionId: session?.id ?? null,
      stateDigest: digestSecret(state),
      browserDigest: digestSecret(browserToken),
      pkceVerifier,
      nonce,
      purpose,
      sessionGeneration: stateRecord.sessionGeneration,
      expiresAt: new Date(now().getTime() + 10 * 60_000),
    })
    return null
  })
  if (denial) throw denial
  let authorizationUrl: string
  try {
    authorizationUrl = await oidc.authorizationUrl(state, pkceVerifier, nonce)
  } catch {
    await store.lock(async (records) => {
      await records.consumeAuthorizationAttempt(digestSecret(state))
      await records.audit({
        event: "authentication.provider_failed",
        outcome: "failed",
        actorUserId: null,
        sessionId: null,
        authenticationProviderRevisionId: oidcProviderRevisionId,
      })
    })
    throw new AuthenticationError(
      503,
      "authentication_provider_failed",
      "The authentication provider failed.",
    )
  }
  return {
    authorizationUrl,
    browserToken,
  }
}
