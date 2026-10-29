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
  if (attempt.purpose === "link-identity") {
    throw new AuthenticationError(
      401,
      "invalid_authorization",
      "The authorization request is invalid.",
    )
  }
  const authorizationAttempt = attempt
  const purpose: AuthorizationPurpose = attempt.purpose
  let policyAdmitted = false
  async function reportProviderFailure(error: unknown): Promise<never> {
    await store.lock((records) =>
      records.audit({
        event: "authentication.provider_failed",
        outcome: "failed",
        actorUserId: null,
        sessionId: authorizationAttempt.originatingSessionId,
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
  const profile: GitHubUserProfile = await github
    .identify(code, authorizationAttempt.pkceVerifier)
    .catch(reportProviderFailure)
  if (authorizationAttempt.purpose === "sign-in") {
    const policyNeeded = await store.lock(async (records) => {
      const identity = await records.externalIdentity(
        "github",
        configuration.issuer,
        profile.subject,
      )
      const membership = identity ? await records.membership(identity.userId) : null
      const invitation =
        !membership || membership.status === "removed"
          ? await records.usableInvitation("github", configuration.issuer, profile.subject, now())
          : null
      return !membership && !invitation
    })
    if (policyNeeded) {
      try {
        policyAdmitted = await admissionPolicy.admit(profile)
      } catch (error) {
        await reportProviderFailure(error)
      }
    }
  }
  const result = await store.lock(async (records) => {
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
    if (purpose === "verify") {
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
        outcome: "succeeded",
        actorUserId: session.userId,
        sessionId: session.id,
        authenticationProviderRevisionId: providerRevisionId,
      })
      return { purpose: "verify" as const }
    }
    let identity = await records.externalIdentity("github", configuration.issuer, profile.subject)
    let membership = identity ? await records.membership(identity.userId) : null
    const invitation =
      purpose === "sign-in" && membership?.status !== "active" && membership?.status !== "suspended"
        ? await records.usableInvitation("github", configuration.issuer, profile.subject, now())
        : null
    if (
      purpose === "sign-in" &&
      membership?.status !== "active" &&
      !invitation &&
      !(policyAdmitted && !membership)
    ) {
      await records.audit({
        event: "authentication.admission_denied",
        outcome: "denied",
        actorUserId: identity?.userId ?? null,
        sessionId: null,
        authenticationProviderRevisionId: providerRevisionId,
        targetMembershipId: membership?.id ?? null,
        context: { reason: membership?.status ?? "unassigned" },
      })
      return { denied: true as const }
    }
    if (purpose === "bootstrap") {
      const activeAdministrators = await records.activeAdministratorCount()
      const completed = activeAdministrators === 0 && (await records.completeBootstrap(now()))
      if (!completed) {
        await records.audit({
          event: "membership.bootstrap",
          outcome: "denied",
          actorUserId: identity?.userId ?? null,
          sessionId: null,
          authenticationProviderRevisionId: providerRevisionId,
          context: { reason: "unavailable" },
        })
        return { denied: true as const }
      }
    } else if (purpose === "recovery" && (await records.activeAdministratorCount()) > 0) {
      await records.audit({
        event: "membership.recovery",
        outcome: "denied",
        actorUserId: identity?.userId ?? null,
        sessionId: null,
        authenticationProviderRevisionId: providerRevisionId,
        context: { reason: "active_administrator_exists" },
      })
      return { denied: true as const }
    }
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
    membership = await records.membership(identity.userId)
    if (purpose === "bootstrap") {
      membership = await records.saveMembership({
        userId: identity.userId,
        status: "active",
        role: "administrator",
        source: "bootstrap",
        suspendedAt: null,
        removedAt: null,
      })
      await records.audit({
        event: "membership.bootstrap",
        outcome: "succeeded",
        actorUserId: identity.userId,
        sessionId: null,
        authenticationProviderRevisionId: providerRevisionId,
        targetMembershipId: membership.id,
      })
    } else if (purpose === "recovery") {
      membership = await records.saveMembership({
        userId: identity.userId,
        status: "active",
        role: "administrator",
        source: "recovery",
        suspendedAt: null,
        removedAt: null,
      })
      await records.audit({
        event: "membership.recovery",
        outcome: "succeeded",
        actorUserId: identity.userId,
        sessionId: null,
        authenticationProviderRevisionId: providerRevisionId,
        targetMembershipId: membership.id,
      })
    } else if (!membership || membership.status !== "active") {
      if (invitation && membership?.status !== "suspended") {
        membership = await records.saveMembership({
          userId: identity.userId,
          status: "active",
          role: invitation.role,
          source: "invitation",
          suspendedAt: null,
          removedAt: null,
        })
        const consumed = await records.consumeInvitation(
          invitation.id,
          identity.id,
          membership.id,
          now(),
        )
        if (!consumed) {
          throw new AuthenticationError(
            409,
            "invitation_changed",
            "The invitation changed. Start again.",
          )
        }
        await records.audit({
          event: "membership.invitation.activate",
          outcome: "succeeded",
          actorUserId: identity.userId,
          sessionId: null,
          authenticationProviderRevisionId: providerRevisionId,
          targetMembershipId: membership.id,
          invitationId: invitation.id,
        })
      } else if (policyAdmitted && !membership) {
        membership = await records.saveMembership({
          userId: identity.userId,
          status: "active",
          role: "member",
          source: "synchronized",
          suspendedAt: null,
          removedAt: null,
        })
        await records.audit({
          event: "membership.synchronize",
          outcome: "succeeded",
          actorUserId: identity.userId,
          sessionId: null,
          authenticationProviderRevisionId: providerRevisionId,
          targetMembershipId: membership.id,
          context: { source: "legacy_repository" },
        })
      }
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
      outcome: "succeeded",
      actorUserId: identity.userId,
      sessionId: session.id,
      authenticationProviderRevisionId: providerRevisionId,
    })
    return { sessionToken, purpose, denied: false as const }
  })
  if ("denied" in result && result.denied) {
    throw new AuthenticationError(403, "admission_denied", "This identity is not admitted.")
  }
  return result
}
