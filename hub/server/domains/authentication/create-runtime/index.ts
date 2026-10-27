import path from "node:path"
import os from "node:os"

import { createAdmissionPolicy } from "#server/domains/authentication/create-admission-policy"
import { createArtifactPublishingService } from "#server/domains/artifact-publishing/create-service"
import { createAdministrationService } from "#server/domains/administration/create-service"
import { createAuthenticationService } from "#server/domains/authentication/create-service"
import type { AuthenticationSettings } from "#server/domains/authentication/create-service/types"
import { ensureGitHubProviderRevision } from "#server/domains/authentication/ensure-provider-revision"
import { ensureOidcProviderRevision } from "#server/domains/authentication/ensure-oidc-provider-revision"
import { readOidcConfiguration } from "#server/domains/authentication/read-oidc-configuration"
import { createIdentityStore } from "#server/domains/identity/create-store"
import { createPrototypeAuthorizationService } from "#server/domains/prototype-authorization/create-service"
import { createGitHubAuthorizationService } from "#server/domains/github-authorization/create-service"
import { createGitHubUserAuthClient } from "#server/integrations/github/create-user-auth-client"
import { createLocalArtifactStorage } from "#server/integrations/artifact-storage/create-local-storage"
import type { GitHubUserAuthConfiguration } from "#server/integrations/github/create-user-auth-client/types"
import { createOidcClient } from "#server/integrations/oidc/create-client"
import { readTrustedProxyHops } from "#server/integrations/express/read-trusted-proxy-hops"
import { prisma } from "#server/integrations/prisma"

function readOrigin(environment: NodeJS.ProcessEnv): URL {
  const origin = new URL(environment.HUB_ORIGIN ?? "http://127.0.0.1:5173")
  const secure = origin.protocol === "https:"
  if (
    !["https:", "http:"].includes(origin.protocol) ||
    origin.origin !== origin.href.replace(/\/$/, "") ||
    origin.username ||
    origin.password ||
    (!secure &&
      (environment.NODE_ENV === "production" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)))
  ) {
    throw new Error(
      "Set HUB_ORIGIN to an HTTPS origin, or a loopback HTTP origin outside production.",
    )
  }
  return origin
}

function readGitHubAuthentication(
  environment: NodeJS.ProcessEnv,
  origin: URL,
): GitHubUserAuthConfiguration | null {
  const clientId = environment.HUB_GITHUB_AUTH_CLIENT_ID
  const clientSecret = environment.HUB_GITHUB_AUTH_CLIENT_SECRET
  if (!clientId && !clientSecret) return null
  if (
    !clientId ||
    !clientSecret ||
    clientId.length > 255 ||
    clientSecret.length < 20 ||
    clientSecret.length > 1024
  ) {
    throw new Error("Set both HUB_GITHUB_AUTH_CLIENT_ID and HUB_GITHUB_AUTH_CLIENT_SECRET.")
  }
  return {
    clientId,
    clientSecret,
    callbackUrl: `${origin.origin}/api/auth/github/callback`,
    issuer: "https://github.com",
  }
}

function readHostSecret(environment: NodeJS.ProcessEnv, key: string): string | null {
  const value = environment[key]
  if (!value) return null
  if (value.length < 32 || value.length > 1_024) {
    throw new Error(`${key} must contain between 32 and 1024 characters.`)
  }
  return value
}

export async function createAuthenticationRuntime(environment: NodeJS.ProcessEnv) {
  const origin = readOrigin(environment)
  const selectedProvider = environment.HUB_AUTH_PROVIDER
  if (selectedProvider && !["github", "oidc"].includes(selectedProvider)) {
    throw new Error("HUB_AUTH_PROVIDER must be github or oidc.")
  }
  const provider = selectedProvider === "oidc" ? "oidc" : "github"
  const configuration = provider === "github" ? readGitHubAuthentication(environment, origin) : null
  const oidcConfiguration = provider === "oidc" ? readOidcConfiguration(environment, origin) : null
  const store = createIdentityStore(prisma)
  const githubAuthorization = createGitHubAuthorizationService({
    database: prisma,
    environment,
    store,
  })
  const providerRevision = configuration
    ? await ensureGitHubProviderRevision(store, configuration)
    : null
  const oidcProviderRevision = oidcConfiguration
    ? await ensureOidcProviderRevision(store, oidcConfiguration)
    : null
  const admissionPolicy = createAdmissionPolicy(environment, store, githubAuthorization)
  const bootstrapSecret = readHostSecret(environment, "HUB_BOOTSTRAP_SECRET")
  const recoverySecret = readHostSecret(environment, "HUB_ADMIN_RECOVERY_SECRET")
  if (bootstrapSecret && recoverySecret && bootstrapSecret === recoverySecret) {
    throw new Error("HUB_BOOTSTRAP_SECRET and HUB_ADMIN_RECOVERY_SECRET must be different.")
  }
  const settings: AuthenticationSettings = {
    origin: origin.origin,
    secureCookies: origin.protocol === "https:",
    configured: provider === "oidc" ? oidcConfiguration?.enabled === true : configuration !== null,
    provider: provider === "oidc" ? "oidc" : configuration ? "github" : null,
    providerLabel: provider === "oidc" ? "Microsoft Entra ID" : configuration ? "GitHub" : null,
    admissionPolicy: admissionPolicy.name,
    trustedProxyHops: readTrustedProxyHops(environment),
  }
  const artifactStoragePath = path.resolve(
    environment.HUB_ARTIFACT_STORAGE_PATH ?? path.join(os.homedir(), ".replica", "artifacts"),
  )
  return {
    administration: createAdministrationService({ store }),
    artifactPublishing: createArtifactPublishingService({
      database: prisma,
      storage: createLocalArtifactStorage(artifactStoragePath),
    }),
    githubAuthorization,
    prototypeAuthorization: createPrototypeAuthorizationService({
      baseline: {
        baseline: (database, userId, prototypeId) =>
          githubAuthorization.prototypeBaseline(database, userId, prototypeId),
        workspaceIds: (database, userId) =>
          githubAuthorization.prototypeWorkspaceIds(database, userId),
      },
      database: prisma,
      store,
    }),
    service: createAuthenticationService({
      store,
      github: configuration ? createGitHubUserAuthClient(configuration) : null,
      configuration,
      providerRevisionId: providerRevision?.id ?? null,
      oidc: oidcConfiguration ? createOidcClient(oidcConfiguration) : null,
      oidcConfiguration,
      oidcProviderRevisionId: oidcProviderRevision?.id ?? null,
      provider,
      admissionPolicy,
      bootstrapSecret,
      recoverySecret,
    }),
    settings,
  }
}
