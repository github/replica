import { randomBytes } from "node:crypto"

import type {
  AuthenticationDependencies,
  AuthorizationPurpose,
} from "#server/domains/authentication/create-service/types"
import type { GitHubUserProfile } from "#server/integrations/github/create-user-auth-client/types"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"
import { secretsMatch } from "#server/utils/secrets-match"

export async function completeGitHubAuthorization(
  dependencies: AuthenticationDependencies,
  code: string,
  state: string,
  browserToken: string,
): Promise<{ sessionToken?: string; purpose: AuthorizationPurpose }> {
  const { admissionPolicy, configuration, github, now, providerRevisionId, store } = dependencies
  if (!configuration || !github || !providerRevisionId) {
    throw new AuthenticationError(
      503,
      "authentication_unconfigured",
      "GitHub authentication is not configured.",
    )
  }
  const attempt = await store.lock((records) =>
    records.consumeAuthorizationAttempt(digestSecret(state)),
  )
  if (
    !attempt ||
    !browserToken ||
    !secretsMatch(digestSecret(browserToken), attempt.browserDigest) ||
    attempt.authenticationProviderRevisionId !== providerRevisionId
  ) {
    throw new AuthenticationError(
      401,
      "invalid_authorization",
      "The authorization request is invalid or expired.",
    )
  }
  let profile: GitHubUserProfile
  let admitted: boolean
  try {
    profile = await github.identify(code, attempt.pkceVerifier)
    admitted = attempt.purpose === "verify" ? true : await admissionPolicy.admit(profile)
  } catch (error) {
    await store.lock((records) =>
      records.audit({
        event: "authentication.provider_failed",
        actorUserId: null,
        sessionId: attempt.originatingSessionId,
        authenticationProviderRevisionId: providerRevisionId,
      }),
    )
    if (error instanceof AuthenticationError) throw error
    throw new AuthenticationError(
      503,
      "authentication_provider_failed",
      "The authentication provider failed.",
    )
  }
  if (!admitted) {
    await store.lock((records) =>
      records.audit({
        event: "authentication.admission_denied",
        actorUserId: null,
        sessionId: null,
        authenticationProviderRevisionId: providerRevisionId,
      }),
    )
    throw new AuthenticationError(403, "admission_denied", "This identity is not admitted.")
  }
  return store.lock(async (records) => {
    const [currentProvider, stateRecord] = await Promise.all([
      records.currentAuthenticationProviderRevision("github"),
      records.identityStoreState(),
    ])
    if (
      currentProvider?.id !== providerRevisionId ||
      stateRecord.sessionGeneration !== attempt.sessionGeneration
    ) {
      throw new AuthenticationError(
        401,
        "authorization_superseded",
        "The authorization request was superseded.",
      )
    }
    if (attempt.purpose === "verify") {
      const session = attempt.originatingSessionId
        ? await records.sessionById(attempt.originatingSessionId)
        : null
      if (
        !session ||
        session.externalIdentity.provider !== "github" ||
        session.externalIdentity.issuer !== configuration.issuer ||
        session.externalIdentity.subject !== profile.subject
      ) {
        throw new AuthenticationError(403, "identity_mismatch", "Verify the same GitHub identity.")
      }
      await records.verifySession(session.id, now())
      await records.audit({
        event: "session.verify",
        actorUserId: session.userId,
        sessionId: session.id,
        authenticationProviderRevisionId: providerRevisionId,
      })
      return { purpose: "verify" }
    }
    let identity = await records.externalIdentity("github", configuration.issuer, profile.subject)
    if (!identity) {
      const user = await records.createUser({
        displayName: profile.displayName ?? profile.username,
        avatarUrl: profile.avatarUrl,
      })
      identity = await records.saveExternalIdentity({
        userId: user.id,
        provider: "github",
        issuer: configuration.issuer,
        subject: profile.subject,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      })
    } else {
      await records.updateUser(identity.userId, {
        displayName: profile.displayName ?? profile.username,
        avatarUrl: profile.avatarUrl,
      })
      identity = await records.saveExternalIdentity({
        userId: identity.userId,
        provider: "github",
        issuer: configuration.issuer,
        subject: profile.subject,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      })
    }
    const sessionToken = randomBytes(32).toString("base64url")
    const session = await records.createSession({
      userId: identity.userId,
      externalIdentityId: identity.id,
      authenticationProviderRevisionId: providerRevisionId,
      tokenDigest: digestSecret(sessionToken),
      signedInAt: now(),
      freshAuthorizedAt: now(),
    })
    await records.audit({
      event: "session.sign_in",
      actorUserId: identity.userId,
      sessionId: session.id,
      authenticationProviderRevisionId: providerRevisionId,
    })
    return { sessionToken, purpose: "sign-in" }
  })
}
