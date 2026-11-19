import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"
import { githubBuildRecoveryWindowMs } from "../../domains/github-builds/constants.ts"
import { logger } from "../../integrations/pino/index.ts"

/** Polls GitHub so Builds still import when webhooks cannot reach the Hub. */
export async function discoverGitHubWorkflowRunsJob(): Promise<void> {
  if (!readAuthenticationConfigurationState(process.env).githubSettingsPresent) return
  const credentials = readGitHubAppConfiguration(process.env).appCredentials
  if (!credentials) return
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required for GitHub Build discovery.")

  const [
    { discoverGitHubWorkflowRuns },
    { enqueueGitHubWorkflowRunRetries },
    { createGitHubActionsClient },
    { prisma },
  ] = await Promise.all([
    import("../../domains/github-builds/discover-github-workflow-runs/index.ts"),
    import("../../domains/github-builds/enqueue-github-workflow-run-retries/index.ts"),
    import("../../integrations/github/create-github-actions-client/index.ts"),
    import("../../integrations/prisma/index.ts"),
  ])
  const jobs = await discoverGitHubWorkflowRuns(
    {
      database: prisma,
      listWorkflowRuns: (githubRepositoryId, createdAfter) =>
        createGitHubActionsClient({ ...credentials, githubRepositoryId }).listWorkflowRuns(
          createdAfter,
        ),
      logger,
    },
    { createdAfter: new Date(Date.now() - githubBuildRecoveryWindowMs) },
  )
  await enqueueGitHubWorkflowRunRetries({ databaseUrl, logger }, jobs)
}
