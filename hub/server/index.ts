import "dotenv/config"

import { createConfiguredArtifactStorage } from "./domains/artifacts/create-configured-artifact-storage/index.ts"
import { LocalSignInConfigurationError } from "./domains/authentication/errors.ts"
import { readAuthenticationConfigurationState } from "./domains/authentication/read-authentication-configuration-state/index.ts"
import { createGitHubAuthenticationContext } from "./domains/authentication/create-github-authentication-context/index.ts"
import { createSharedAuthenticationContext } from "./domains/authentication/create-shared-authentication-context/index.ts"
import { readGitHubAppConfiguration } from "./domains/authentication/read-github-app-configuration/index.ts"
import { resolveLocalSignInEnvironment } from "./domains/authentication/resolve-local-sign-in-environment/index.ts"
import { startTelemetry } from "./integrations/opentelemetry/start-telemetry/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { isMissingDatabaseSchema } from "./integrations/prisma/is-missing-database-schema/index.ts"
import { runApi } from "./run-api/index.ts"
import { setup } from "./scripts/setup/index.ts"
import { startServerProcesses } from "./start-server-processes/index.ts"
import { parseRuntimeConfig } from "./utils/parse-runtime-config/index.ts"
import { jobProcessors } from "./workers/configuration.ts"
import { runJobWorker } from "./workers/run-job-worker/index.ts"
import type { AuthenticationRouteDependencies } from "./routes/api/auth/types.ts"
import type { ProductRouteDependencies } from "./routes/api/product/types.ts"
import type { GitHubWebhookRouteDependencies } from "./routes/api/github/webhooks/types.ts"
import type { GitHubSetupRouteDependencies } from "./routes/api/settings/github/types.ts"

class AuthenticationConfigurationError extends Error {}

try {
  const configuration = parseRuntimeConfig(process.env)
  const storage =
    configuration.mode !== "setup" && configuration.hasArtifactStorage
      ? await createConfiguredArtifactStorage(process.env)
      : undefined
  const isStorageReady = storage ? () => storage.isReady() : undefined
  const telemetry = startTelemetry(process.env, logger)
  try {
    const runsApi = configuration.mode === "api" || configuration.mode === "combined"
    const configuredTrustedProxyHops = Number(process.env.HUB_TRUSTED_PROXY_HOPS ?? 0)
    if (
      runsApi &&
      (!Number.isInteger(configuredTrustedProxyHops) ||
        configuredTrustedProxyHops < 0 ||
        configuredTrustedProxyHops > 10)
    ) {
      throw new Error("HUB_TRUSTED_PROXY_HOPS must be an integer between 0 and 10.")
    }
    const trustedProxyHops = runsApi ? configuredTrustedProxyHops : 0
    let authentication: AuthenticationRouteDependencies | undefined
    let product: ProductRouteDependencies | undefined
    let githubSetup: GitHubSetupRouteDependencies | undefined
    let githubWebhooks: GitHubWebhookRouteDependencies | undefined
    if (runsApi) {
      const authenticationEnvironment = resolveLocalSignInEnvironment(process.env)
      const authenticationConfiguration =
        readAuthenticationConfigurationState(authenticationEnvironment)
      if (authenticationConfiguration.githubStatus === "incomplete") {
        if (authenticationConfiguration.githubProblems.every(({ state }) => state === "invalid")) {
          const names = authenticationConfiguration.githubProblems.map(({ key }) => key).join(", ")
          throw new AuthenticationConfigurationError(
            `GitHub App configuration is invalid. Check: ${names}.`,
          )
        }
        logger.warn(
          { settings: authenticationConfiguration.githubProblems },
          "GitHub sign-in is disabled until setup is complete at /settings/github/setup",
        )
      }
      if (
        (authenticationConfiguration.providerConfigured ||
          authenticationConfiguration.githubSettingsPresent ||
          authenticationConfiguration.sharedConfigured) &&
        !authenticationConfiguration.applicationOrigin
      ) {
        throw new AuthenticationConfigurationError(
          "HUB_APPLICATION_ORIGIN is required when authentication settings are configured.",
        )
      }
      if (
        (authenticationConfiguration.providerConfigured ||
          authenticationConfiguration.sharedConfigured ||
          authenticationConfiguration.applicationOrigin) &&
        !configuration.databaseUrl
      ) {
        throw new AuthenticationConfigurationError(
          "DATABASE_URL is required when authentication settings are configured.",
        )
      }
      if (authenticationConfiguration.applicationOrigin) {
        try {
          createSharedAuthenticationContext(authenticationEnvironment)
        } catch (error) {
          throw new AuthenticationConfigurationError(
            "HUB_APPLICATION_ORIGIN, HUB_AUTHENTICATION_ENCRYPTION_KEY, and HUB_BOOTSTRAP_SECRET must be valid before setup. See the authentication guide.",
            { cause: error },
          )
        }
      }
      if (configuration.databaseUrl) {
        const { createAuthenticationRouteDependencies, disableAuthenticationProviders } =
          await import("./routes/api/auth/create-authentication-route-dependencies/index.ts")
        try {
          if (authenticationConfiguration.providerConfigured) {
            authentication = await createAuthenticationRouteDependencies(authenticationEnvironment)
            const { createProductRouteDependencies } =
              await import("./routes/api/product/create-product-route-dependencies/index.ts")
            product = createProductRouteDependencies({
              scopeGitHubMembers: authenticationConfiguration.githubConfigured,
            })
          } else {
            await disableAuthenticationProviders()
          }
          // Local sign-in refuses GitHub settings, so GitHub setup would be a dead end there.
          if (
            authenticationConfiguration.applicationOrigin &&
            !authenticationConfiguration.localConfigured
          ) {
            const { createGitHubSetupRouteDependencies } =
              await import("./routes/api/settings/github/create-github-setup-route-dependencies/index.ts")
            const setup = createGitHubSetupRouteDependencies(authenticationEnvironment)
            githubSetup = setup
            const { appCredentials } = readGitHubAppConfiguration(authenticationEnvironment)
            if (appCredentials && authenticationConfiguration.githubConfigured) {
              const context = createGitHubAuthenticationContext(authenticationEnvironment)
              const { createGitHubWebhookRouteDependencies } =
                await import("./routes/api/github/webhooks/create-github-webhook-route-dependencies/index.ts")
              githubWebhooks = createGitHubWebhookRouteDependencies({
                installationId: appCredentials.installationId,
                provider: {
                  configurationDigest: context.configurationDigest,
                  revision: context.providerRevision,
                },
                syncRepositories: () => setup.syncRepositories(),
                webhookSecret: appCredentials.webhookSecret,
              })
            }
          }
        } catch (error) {
          if (isMissingDatabaseSchema(error)) {
            throw new AuthenticationConfigurationError(
              "Hub database setup is required before API startup. Run npm run setup.",
            )
          }
          throw error
        }
      }
    }
    if (configuration.mode === "setup") await setup()
    else if (configuration.mode === "api")
      await runApi({
        ...configuration,
        logger,
        isReady: isStorageReady,
        authentication,
        githubSetup,
        githubWebhooks,
        product,
        trustedProxyHops,
      })
    else {
      const databaseUrl = configuration.databaseUrl
      if (!databaseUrl) throw new Error("This runtime mode requires DATABASE_URL.")
      if (configuration.mode === "combined") {
        await startServerProcesses({
          ...configuration,
          databaseUrl,
          logger,
          isStorageReady,
          authentication,
          githubSetup,
          githubWebhooks,
          product,
          trustedProxyHops,
        })
      } else {
        const name = configuration.mode
        await runJobWorker({
          name,
          databaseUrl,
          concurrency:
            name === "on-demand"
              ? configuration.onDemandConcurrency
              : configuration.scheduledConcurrency,
          shutdownTimeoutMs: configuration.shutdownTimeoutMs,
          logger,
          processors: jobProcessors[name],
        })
      }
    }
  } finally {
    await telemetry.shutdown()
  }
} catch (error) {
  logger.fatal(
    error instanceof AuthenticationConfigurationError ||
      error instanceof LocalSignInConfigurationError
      ? error.message
      : "Hub failed; check runtime configuration, dependencies, telemetry, and shutdown time.",
  )
  process.exit(1)
}
