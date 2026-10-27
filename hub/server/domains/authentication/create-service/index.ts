import { completeGitHubAuthorization } from "#server/domains/authentication/complete-github-authorization"
import type {
  AuthenticationDependencies,
  AuthenticationService,
} from "#server/domains/authentication/create-service/types"
import { getCurrentSession } from "#server/domains/authentication/get-current-session"
import { revokeSessions } from "#server/domains/authentication/revoke-sessions"
import { signOut } from "#server/domains/authentication/sign-out"
import { startGitHubAuthorization } from "#server/domains/authentication/start-github-authorization"

export function createAuthenticationService(
  options: Omit<AuthenticationDependencies, "now"> & { now?: () => Date },
): AuthenticationService {
  const dependencies: AuthenticationDependencies = {
    ...options,
    now: options.now ?? (() => new Date()),
  }
  return {
    start: startGitHubAuthorization.bind(null, dependencies),
    complete: completeGitHubAuthorization.bind(null, dependencies),
    current: getCurrentSession.bind(null, dependencies),
    signOut: signOut.bind(null, dependencies),
    revokeAll: revokeSessions.bind(null, dependencies),
  }
}
