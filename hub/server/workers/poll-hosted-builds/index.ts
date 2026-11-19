import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"
import { createGitHubAuthenticationContext } from "../../domains/authentication/create-github-authentication-context/index.ts"
import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { logger } from "../../integrations/pino/index.ts"

export async function pollConfiguredHostedBuilds() {
  if (!readAuthenticationConfigurationState(process.env).githubSettingsPresent) return
  const configuration = readGitHubAppConfiguration(process.env)
  if (configuration.app === "not_configured") return
  if (!configuration.appCredentials || !configuration.signInCredentials)
    throw new Error("Hosted Builds require complete GitHub App installation settings.")
  if (!process.env.ARTIFACT_STORAGE_PROVIDER) return

  const context = createGitHubAuthenticationContext(process.env)
  const [{ pollHostedBuilds }, { prisma }, storage] = await Promise.all([
    import("../../domains/hosted-builds/poll-hosted-builds/index.ts"),
    import("../../integrations/prisma/index.ts"),
    createConfiguredArtifactStorage(process.env),
  ])
  const summary = await pollHostedBuilds({
    database: prisma,
    storage,
    credentials: configuration.appCredentials,
    provider: {
      configurationDigest: context.configurationDigest,
      revision: context.providerRevision,
    },
    logger,
  })
  logger.info(summary, "Hosted Build poll finished")
}
