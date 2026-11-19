import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"
import { githubBuildRecoveryWindowMs } from "../../domains/github-builds/constants.ts"
import { logger } from "../../integrations/pino/index.ts"

/** Polls GitHub so Builds still import when webhooks cannot reach the Hub. */
export async function discoverGitHubWorkflowRunsJob(): Promise<void> {
  if (!readAuthenticationConfigurationState(process.env).githubSettingsPresent) return
  const configuration = readGitHubAppConfiguration(process.env)
  if (configuration.app === "not_configured") return
  const credentials = configuration.appCredentials
  if (!credentials) throw new Error("GitHub App installation settings are incomplete or invalid.")
  const configuredCredentials = credentials
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
  const clients = new Map<number, ReturnType<typeof createGitHubActionsClient>>()
  function client(githubRepositoryId: number) {
    let existing = clients.get(githubRepositoryId)
    if (!existing) {
      existing = createGitHubActionsClient({ ...configuredCredentials, githubRepositoryId })
      clients.set(githubRepositoryId, existing)
    }
    return existing
  }
  const jobs = await discoverGitHubWorkflowRuns(
    {
      database: prisma,
      listBranchHeads: (githubRepositoryId) => client(githubRepositoryId).listBranchHeads(),
      isAncestor: (githubRepositoryId, base, head) =>
        client(githubRepositoryId).isAncestor(base, head),
      listWorkflowRuns: (githubRepositoryId, createdAfter) =>
        client(githubRepositoryId).listWorkflowRuns(createdAfter),
      logger,
    },
    { createdAfter: new Date(Date.now() - githubBuildRecoveryWindowMs) },
  )
  await enqueueGitHubWorkflowRunRetries({ databaseUrl, logger }, jobs)
}
