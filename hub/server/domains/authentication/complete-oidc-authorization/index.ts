import { randomBytes } from "node:crypto"

import type {
  AuthenticationDependencies,
  AuthorizationPurpose,
} from "#server/domains/authentication/create-service/types"
import { AuthenticationError } from "#server/utils/authentication-error"
import { digestSecret } from "#server/utils/digest-secret"
import { secretsMatch } from "#server/utils/secrets-match"

export async function completeOidcAuthorization(
  dependencies: AuthenticationDependencies,
  code: string,
  state: string,
  browserToken: string,
): Promise<{ sessionToken?: string; purpose: AuthorizationPurpose }> {
  const { now, oidc, oidcConfiguration, oidcProviderRevisionId, store } = dependencies
  if (!oidcConfiguration?.enabled || !oidc || !oidcProviderRevisionId) {
    throw new AuthenticationError(
      503,
      "authentication_unconfigured",
      "OIDC authentication is not configured.",
    )
  }
  const attempt = await store.lock((records) =>
    records.consumeAuthorizationAttempt(digestSecret(state)),
  )
  if (
    !attempt ||
    !attempt.nonce ||
    !browserToken ||
    !secretsMatch(digestSecret(browserToken), attempt.browserDigest) ||
    attempt.authenticationProviderRevisionId !== oidcProviderRevisionId ||
    attempt.expiresAt <= now()
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
  const purpose: AuthorizationPurpose = attempt.purpose
  let profile
  try {
    profile = await oidc.identify(code, attempt.pkceVerifier, attempt.nonce)
  } catch {
    await store.lock((records) =>
      records.audit({
        event: "authentication.provider_failed",
        outcome: "failed",
        actorUserId: null,
        sessionId: attempt.originatingSessionId,
        authenticationProviderRevisionId: oidcProviderRevisionId,
      }),
    )
    throw new AuthenticationError(
      503,
      "authentication_provider_failed",
      "The authentication provider failed.",
    )
  }
  const result = await store.lock(async (records) => {
    const [currentProvider, stateRecord] = await Promise.all([
      records.currentAuthenticationProviderRevision("oidc"),
      records.identityStoreState(),
    ])
    if (
      currentProvider?.id !== oidcProviderRevisionId ||
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
      const membership = session ? await records.membership(session.userId) : null
      if (
        !session ||
        session.externalIdentity.provider !== "oidc" ||
        session.externalIdentity.issuer !== oidcConfiguration.issuer ||
        session.externalIdentity.subject !== profile.subject
      ) {
        throw new AuthenticationError(403, "identity_mismatch", "Verify the same OIDC identity.")
      }
      if (!profile.role || membership?.status !== "active" || membership.role !== profile.role) {
        await records.audit({
          event: "session.verify",
          outcome: "denied",
          actorUserId: session.userId,
          sessionId: session.id,
          authenticationProviderRevisionId: oidcProviderRevisionId,
          targetMembershipId: membership?.id ?? null,
          context: { reason: "provider_role_changed" },
        })
        throw new AuthenticationError(
          403,
          "provider_role_changed",
          "Your provider role changed. Sign in again.",
        )
      }
      await records.verifySession(session.id, now())
      await records.audit({
        event: "session.verify",
        outcome: "succeeded",
        actorUserId: session.userId,
        sessionId: session.id,
        authenticationProviderRevisionId: oidcProviderRevisionId,
      })
      return { purpose: "verify" as const }
    }
    const requiredRole = purpose === "bootstrap" || purpose === "recovery" ? "administrator" : null
    if (!profile.role || (requiredRole && profile.role !== requiredRole)) {
      await records.audit({
        event: "authentication.admission_denied",
        outcome: "denied",
        actorUserId: null,
        sessionId: null,
        authenticationProviderRevisionId: oidcProviderRevisionId,
        context: { reason: "required_role_missing" },
      })
      return { denied: true as const }
    }
    let identity = await records.externalIdentity("oidc", oidcConfiguration.issuer, profile.subject)
    let membership = identity ? await records.membership(identity.userId) : null
    const invitationSubject = profile.directoryObjectId
    const invitation =
      purpose === "sign-in" &&
      invitationSubject &&
      membership?.status !== "active" &&
      membership?.status !== "suspended"
        ? await records.usableInvitation("oidc", oidcConfiguration.issuer, invitationSubject, now())
        : null
    if (
      purpose === "sign-in" &&
      (membership?.status === "suspended" ||
        (membership?.status === "removed" && !invitation) ||
        (!membership &&
          oidcConfiguration.membershipPolicy === "invitation-required" &&
          !invitation))
    ) {
      await records.audit({
        event: "authentication.admission_denied",
        outcome: "denied",
        actorUserId: identity?.userId ?? null,
        sessionId: null,
        authenticationProviderRevisionId: oidcProviderRevisionId,
        targetMembershipId: membership?.id ?? null,
        context: {
          reason:
            membership?.status ??
            (invitationSubject ? "invitation_required" : "directory_object_id_missing"),
        },
      })
      return { denied: true as const }
    }
    if (purpose === "bootstrap") {
      const completed =
        (await records.activeAdministratorCount()) === 0 && (await records.completeBootstrap(now()))
      if (!completed) {
        await records.audit({
          event: "membership.bootstrap",
          outcome: "denied",
          actorUserId: identity?.userId ?? null,
          sessionId: null,
          authenticationProviderRevisionId: oidcProviderRevisionId,
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
        authenticationProviderRevisionId: oidcProviderRevisionId,
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
        provider: "oidc",
        issuer: oidcConfiguration.issuer,
        subject: profile.subject,
        directoryObjectId: profile.directoryObjectId,
        username: profile.username,
        email: profile.email,
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
        provider: "oidc",
        issuer: oidcConfiguration.issuer,
        subject: profile.subject,
        directoryObjectId: profile.directoryObjectId,
        username: profile.username,
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      })
    }
    membership = await records.membership(identity.userId)
    if (purpose === "bootstrap" || purpose === "recovery") {
      membership = await records.saveMembership({
        userId: identity.userId,
        status: "active",
        role: "administrator",
        source: purpose,
        suspendedAt: null,
        removedAt: null,
      })
      await records.audit({
        event: `membership.${purpose}`,
        outcome: "succeeded",
        actorUserId: identity.userId,
        sessionId: null,
        authenticationProviderRevisionId: oidcProviderRevisionId,
        targetMembershipId: membership.id,
      })
    } else if (invitation && membership?.status !== "suspended") {
      const invitedRole =
        invitation.role === "administrator" && profile.role === "administrator"
          ? "administrator"
          : "member"
      membership = await records.saveMembership({
        userId: identity.userId,
        status: "active",
        role: invitedRole,
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
        authenticationProviderRevisionId: oidcProviderRevisionId,
        targetMembershipId: membership.id,
        invitationId: invitation.id,
      })
    } else if (!membership) {
      membership = await records.saveMembership({
        userId: identity.userId,
        status: "active",
        role: profile.role,
        source: "oidc-assignment",
        suspendedAt: null,
        removedAt: null,
      })
    } else if (membership.status === "active" && membership.role !== profile.role) {
      if (
        membership.role === "administrator" &&
        profile.role === "member" &&
        (await records.activeAdministratorCount()) <= 1
      ) {
        await records.audit({
          event: "authentication.admission_denied",
          outcome: "denied",
          actorUserId: identity.userId,
          sessionId: null,
          authenticationProviderRevisionId: oidcProviderRevisionId,
          targetMembershipId: membership.id,
          context: { reason: "last_administrator" },
        })
        return { denied: true as const }
      }
      membership = await records.saveMembership({
        userId: membership.userId,
        status: membership.status,
        role: profile.role,
        source: membership.source,
        suspendedAt: membership.suspendedAt,
        removedAt: membership.removedAt,
      })
      await records.audit({
        event: "membership.provider_role.refresh",
        outcome: "succeeded",
        actorUserId: identity.userId,
        sessionId: null,
        authenticationProviderRevisionId: oidcProviderRevisionId,
        targetMembershipId: membership.id,
        context: { role: profile.role },
      })
    }
    if (!membership || membership.status !== "active") return { denied: true as const }
    const sessionToken = randomBytes(32).toString("base64url")
    const session = await records.createSession({
      userId: identity.userId,
      externalIdentityId: identity.id,
      authenticationProviderRevisionId: oidcProviderRevisionId,
      tokenDigest: digestSecret(sessionToken),
      signedInAt: now(),
      freshAuthorizedAt: now(),
    })
    await records.audit({
      event: "session.sign_in",
      outcome: "succeeded",
      actorUserId: identity.userId,
      sessionId: session.id,
      authenticationProviderRevisionId: oidcProviderRevisionId,
    })
    return { sessionToken, purpose, denied: false as const }
  })
  if ("denied" in result && result.denied) {
    throw new AuthenticationError(403, "admission_denied", "This identity is not admitted.")
  }
  return result
}
