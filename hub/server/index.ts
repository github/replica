import "dotenv/config"

import { createConfiguredArtifactStorage } from "./domains/artifacts/create-configured-artifact-storage/index.ts"
import { LocalSignInConfigurationError } from "./domains/authentication/errors.ts"
import { readLearningConfiguration } from "./domains/learning/read-learning-configuration/index.ts"
import { LearningConfigurationError } from "./domains/learning/errors.ts"
import { readAuthenticationConfigurationState } from "./domains/authentication/read-authentication-configuration-state/index.ts"
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
import type { CopilotConnectionRouteDependencies } from "./routes/api/copilot-connection/types.ts"
import type { ProductRouteDependencies } from "./routes/api/product/types.ts"

class AuthenticationConfigurationError extends Error {}

try {
  const configuration = parseRuntimeConfig(process.env)
  if (configuration.mode !== "setup") await readLearningConfiguration(process.env)
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
    let copilotConnection: CopilotConnectionRouteDependencies | undefined
    let product: ProductRouteDependencies | undefined
    if (runsApi) {
      const authenticationEnvironment = resolveLocalSignInEnvironment(process.env)
      const authenticationConfiguration =
        readAuthenticationConfigurationState(authenticationEnvironment)
      if (
        (authenticationConfiguration.providerConfigured ||
          authenticationConfiguration.sharedConfigured) &&
        !authenticationConfiguration.applicationOrigin
      ) {
        throw new AuthenticationConfigurationError(
          "HUB_APPLICATION_ORIGIN is required when authentication settings are configured.",
        )
      }
      if (
        authenticationConfiguration.applicationOrigin &&
        !authenticationConfiguration.providerConfigured
      ) {
        throw new AuthenticationConfigurationError(
          "Configure GitHub, Entra, or local sign-in when HUB_APPLICATION_ORIGIN is set.",
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
      if (configuration.databaseUrl) {
        const { createAuthenticationRouteDependencies, disableAuthenticationProviders } =
          await import("./routes/api/auth/create-authentication-route-dependencies/index.ts")
        try {
          if (authenticationConfiguration.providerConfigured) {
            authentication = await createAuthenticationRouteDependencies(authenticationEnvironment)
            const { createProductRouteDependencies } =
              await import("./routes/api/product/create-product-route-dependencies/index.ts")
            product = createProductRouteDependencies()
            const { createCopilotConnectionRouteDependencies } =
              await import("./routes/api/copilot-connection/create-copilot-connection-route-dependencies/index.ts")
            copilotConnection =
              await createCopilotConnectionRouteDependencies(authenticationEnvironment)
          } else {
            await disableAuthenticationProviders()
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
        copilotConnection,
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
          copilotConnection,
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
      : error instanceof LearningConfigurationError
        ? error.message
        : "Hub failed; check runtime configuration, dependencies, telemetry, and shutdown time.",
  )
  process.exit(1)
}
