import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import { readAuthenticationConfigurationState } from "../../domains/authentication/read-authentication-configuration-state/index.ts"
import { githubBuildRecoveryWindowMs } from "../../domains/github-builds/constants.ts"
import { logger } from "../../integrations/pino/index.ts"

export async function retryGitHubBuildsAwaitingImport(): Promise<void> {
  if (!readAuthenticationConfigurationState(process.env).githubSettingsPresent) return
  if (readGitHubAppConfiguration(process.env).app === "not_configured") return
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error("DATABASE_URL is required for GitHub Build recovery.")

  const [{ listGitHubBuildsAwaitingImport }, { enqueueGitHubWorkflowRunRetries }, { prisma }] =
    await Promise.all([
      import("../../repositories/github-builds/list-github-builds-awaiting-import/index.ts"),
      import("../../domains/github-builds/enqueue-github-workflow-run-retries/index.ts"),
      import("../../integrations/prisma/index.ts"),
    ])
  const builds = await listGitHubBuildsAwaitingImport(prisma, {
    createdAfter: new Date(Date.now() - githubBuildRecoveryWindowMs),
  })
  await enqueueGitHubWorkflowRunRetries({ databaseUrl, logger }, builds)
}
