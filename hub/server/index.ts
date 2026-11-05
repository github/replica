import "dotenv/config"

import { createConfiguredArtifactStorage } from "./domains/artifacts/create-configured-artifact-storage/index.ts"
import { startTelemetry } from "./integrations/opentelemetry/start-telemetry/index.ts"
import { logger } from "./integrations/pino/index.ts"
import { runApi } from "./run-api/index.ts"
import { setup } from "./scripts/setup/index.ts"
import { startServerProcesses } from "./start-server-processes/index.ts"
import { parseRuntimeConfig } from "./utils/parse-runtime-config/index.ts"
import { jobProcessors } from "./workers/configuration.ts"
import { runJobWorker } from "./workers/run-job-worker/index.ts"
import type { AuthenticationRouteDependencies } from "./routes/api/auth/types.ts"

const providerConfigurationKeys = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
  "ENTRA_OIDC_CLIENT_AUTHENTICATION",
  "ENTRA_OIDC_CLIENT_ID",
  "ENTRA_OIDC_CLIENT_SECRET",
  "ENTRA_OIDC_ISSUER",
  "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
  "ENTRA_OIDC_PROVIDER_REVISION",
] as const

const sharedAuthenticationKeys = [
  "HUB_AUTHENTICATION_ENCRYPTION_KEY",
  "HUB_BOOTSTRAP_SECRET",
] as const

function hasConfiguredValue(environment: NodeJS.ProcessEnv, key: string): boolean {
  return environment[key] !== undefined
}

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
    if (runsApi) {
      const providerConfigured = providerConfigurationKeys.some((key) =>
        hasConfiguredValue(process.env, key),
      )
      const sharedAuthenticationConfigured = sharedAuthenticationKeys.some((key) =>
        hasConfiguredValue(process.env, key),
      )
      const applicationOrigin = process.env.HUB_APPLICATION_ORIGIN?.trim()
      if ((providerConfigured || sharedAuthenticationConfigured) && !applicationOrigin) {
        throw new Error(
          "HUB_APPLICATION_ORIGIN is required when authentication settings are configured.",
        )
      }
      if (
        (providerConfigured || sharedAuthenticationConfigured || applicationOrigin) &&
        !configuration.databaseUrl
      ) {
        throw new Error("DATABASE_URL is required when authentication settings are configured.")
      }
      if (configuration.databaseUrl) {
        const { createAuthenticationRouteDependencies, disableAuthenticationProviders } =
          await import("./routes/api/auth/create-authentication-route-dependencies/index.ts")
        if (providerConfigured) {
          authentication = await createAuthenticationRouteDependencies(process.env)
        } else {
          await disableAuthenticationProviders()
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
} catch {
  logger.fatal(
    "Hub failed; check runtime configuration, dependencies, telemetry, and shutdown time.",
  )
  process.exit(1)
}
