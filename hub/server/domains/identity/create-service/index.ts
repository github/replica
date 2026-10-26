import { completeGitHubAuthorization } from "#server/domains/identity/complete-github-authorization"
import { getCurrentSession } from "#server/domains/identity/get-current-session"
import { getProviderConfiguration } from "#server/domains/identity/get-provider-configuration"
import { getRepositoryPermission } from "#server/domains/identity/get-repository-permission"
import { getSecurityAudits } from "#server/domains/identity/get-security-audits"
import { revokeSessions } from "#server/domains/identity/revoke-sessions"
import { rotateGitHubCredentials } from "#server/domains/identity/rotate-github-credentials"
import { setupGitHubCredentials } from "#server/domains/identity/setup-github-credentials"
import { signOut } from "#server/domains/identity/sign-out"
import { signInWithOidcDemo } from "#server/domains/identity/sign-in-with-oidc-demo"
import { startGitHubAuthorization } from "#server/domains/identity/start-github-authorization"
import type { IdentityDependencies, IdentityService } from "#server/utils/identity-contracts/types"

export function createIdentityService(
  options: Omit<IdentityDependencies, "now"> & { now?: () => Date },
): IdentityService {
  const dependencies: IdentityDependencies = { ...options, now: options.now ?? (() => new Date()) }
  return {
    setup: setupGitHubCredentials.bind(null, dependencies),
    start: startGitHubAuthorization.bind(null, dependencies),
    complete: completeGitHubAuthorization.bind(null, dependencies),
    configuration: getProviderConfiguration.bind(null, dependencies),
    signInWithOidcDemo: signInWithOidcDemo.bind(null, dependencies),
    current: getCurrentSession.bind(null, dependencies),
    signOut: signOut.bind(null, dependencies),
    permission: getRepositoryPermission.bind(null, dependencies),
    rotate: rotateGitHubCredentials.bind(null, dependencies),
    revoke: revokeSessions.bind(null, dependencies),
    audits: getSecurityAudits.bind(null, dependencies),
  }
}
