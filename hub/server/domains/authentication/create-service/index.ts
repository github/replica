import { completeGitHubAuthorization } from "#server/domains/authentication/complete-github-authorization"
import { completeOidcAuthorization } from "#server/domains/authentication/complete-oidc-authorization"
import type {
  AuthenticationDependencies,
  AuthenticationService,
} from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { revokeSessions } from "#server/domains/authentication/revoke-sessions"
import { signOut } from "#server/domains/authentication/sign-out"
import { startGitHubAuthorization } from "#server/domains/authentication/start-github-authorization"
import { startOidcAuthorization } from "#server/domains/authentication/start-oidc-authorization"

export function createAuthenticationService(
  options: Omit<AuthenticationDependencies, "now"> & { now?: () => Date },
): AuthenticationService {
  const dependencies: AuthenticationDependencies = {
    ...options,
    now: options.now ?? (() => new Date()),
  }
  return {
    start:
      dependencies.provider === "oidc"
        ? startOidcAuthorization.bind(null, dependencies)
        : startGitHubAuthorization.bind(null, dependencies),
    complete:
      dependencies.provider === "oidc"
        ? completeOidcAuthorization.bind(null, dependencies)
        : completeGitHubAuthorization.bind(null, dependencies),
    current: getCurrentSession.bind(null, dependencies),
    signOut: signOut.bind(null, dependencies),
    revokeAll: revokeSessions.bind(null, dependencies),
  }
}
