import { randomUUID } from "node:crypto"

import { checkAuthenticationRateLimit } from "../../../../../domains/admission/check-authentication-rate-limit/index.ts"
import { syncGitHubInstallationRepositories } from "../../../../../domains/admission/sync-github-installation-repositories/index.ts"
import { verifyBootstrapSecret } from "../../../../../domains/admission/verify-bootstrap-secret/index.ts"
import { createGitHubAuthenticationContext } from "../../../../../domains/authentication/create-github-authentication-context/index.ts"
import { createSharedAuthenticationContext } from "../../../../../domains/authentication/create-shared-authentication-context/index.ts"
import { readGitHubAppConfiguration } from "../../../../../domains/authentication/read-github-app-configuration/index.ts"
import { listInstallationRepositories } from "../../../../../integrations/github/list-installation-repositories/index.ts"
import { testGitHubAppConnection } from "../../../../../integrations/github/test-github-app-connection/index.ts"
import { prisma } from "../../../../../integrations/prisma/index.ts"
import { findAdministratorHubSession } from "../../../../../repositories/hub-sessions/find-administrator-hub-session/index.ts"
import { countEffectiveAdministrators } from "../../../../../repositories/memberships/count-effective-administrators/index.ts"
import { listConnectedGitHubRepositories } from "../../../../../repositories/repository-access/list-connected-github-repositories/index.ts"
import { createSecurityAudit } from "../../../../../repositories/security-audits/create-security-audit/index.ts"
import type { GitHubSetupRouteDependencies } from "../types.ts"

/** Settings are read once because Hub reads deployment secrets only at startup. */
export function createGitHubSetupRouteDependencies(
  environment: NodeJS.ProcessEnv,
): GitHubSetupRouteDependencies {
  const { applicationOrigin, bootstrapSecret } = createSharedAuthenticationContext(environment)
  const configuration = readGitHubAppConfiguration(environment)
  const context =
    configuration.status === "configured"
      ? createGitHubAuthenticationContext(environment)
      : undefined
  const status = {
    status: configuration.status,
    signInEnabled: configuration.status === "configured",
    settings: Object.entries(configuration.settings).map(([key, state]) => ({
      key: key as keyof typeof configuration.settings,
      state,
    })),
    urls: {
      homepage: applicationOrigin,
      callback: `${applicationOrigin}/api/auth/github/callback`,
      setup: `${applicationOrigin}/settings/github/setup?step=install`,
      webhook: `${applicationOrigin}/api/github/webhooks`,
    },
  }
  return {
    applicationOrigin,
    async authorize({ sessionDigest, bootstrapSecret: submitted }) {
      if (sessionDigest) {
        const session = await findAdministratorHubSession(prisma, sessionDigest)
        if (session) return { allowed: true, membershipId: session.membershipId }
      }
      if ((await countEffectiveAdministrators(prisma)) > 0) {
        return { allowed: false, requires: "administrator" }
      }
      if (
        submitted &&
        bootstrapSecret.length >= 32 &&
        verifyBootstrapSecret(bootstrapSecret, submitted)
      ) {
        return { allowed: true, membershipId: null }
      }
      return { allowed: false, requires: "bootstrap" }
    },
    async checkRateLimit(operation, subjectDigest) {
      const result = await checkAuthenticationRateLimit(
        {
          auditFirstDenial: false,
          createId: randomUUID,
          limit: operation === "github_test" ? 6 : 20,
          operation,
          subjectDigest,
          windowSeconds: 60,
        },
        prisma,
      )
      return result.allowed
    },
    async readStatus() {
      const repositories = configuration.appCredentials
        ? await listConnectedGitHubRepositories(prisma)
        : []
      return {
        ...status,
        connectedRepositories: repositories.map((repository) => repository.nameWithOwner).sort(),
      }
    },
    async testConnection() {
      if (configuration.status !== "configured" || !configuration.appCredentials) return null
      return testGitHubAppConnection({
        ...configuration.appCredentials,
        clientId: configuration.signInCredentials?.clientId,
      })
    },
    async syncRepositories() {
      const credentials = configuration.appCredentials
      if (!credentials) {
        throw new Error("GitHub App installation credentials are not configured.")
      }
      if (!context) throw new Error("GitHub sign-in is not configured.")
      const repositories = await syncGitHubInstallationRepositories(
        prisma,
        () => listInstallationRepositories(credentials),
        { configurationDigest: context.configurationDigest, revision: context.providerRevision },
      )
      return repositories.map((repository) => repository.nameWithOwner)
    },
    async writeTestAudit({ actorMembershipId, failedChecks }) {
      await createSecurityAudit(prisma, {
        id: randomUUID(),
        type: "github_app_connection_tested",
        actorMembershipId,
        failedChecks,
      })
    },
  }
}
