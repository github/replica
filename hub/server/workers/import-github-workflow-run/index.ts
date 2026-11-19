import { readGitHubAppConfiguration } from "../../domains/authentication/read-github-app-configuration/index.ts"
import type { GitHubWorkflowRunJob } from "../../domains/github-builds/get-github-workflow-run-job-definition/index.ts"
import { logger } from "../../integrations/pino/index.ts"

export async function importGitHubWorkflowRunJob(job: GitHubWorkflowRunJob) {
  const credentials = readGitHubAppConfiguration(process.env).appCredentials
  if (!credentials) throw new Error("GitHub App installation settings are incomplete or invalid.")
  const [
    { importGitHubWorkflowRun },
    { createGitHubActionsClient },
    { createConfiguredArtifactStorage },
    { prisma },
  ] = await Promise.all([
    import("../../domains/github-builds/import-github-workflow-run/index.ts"),
    import("../../integrations/github/create-github-actions-client/index.ts"),
    import("../../domains/artifacts/create-configured-artifact-storage/index.ts"),
    import("../../integrations/prisma/index.ts"),
  ])
  return await importGitHubWorkflowRun(
    {
      database: prisma,
      storage: await createConfiguredArtifactStorage(process.env),
      client: createGitHubActionsClient({
        appId: credentials.appId,
        installationId: credentials.installationId,
        privateKey: credentials.privateKey,
        githubRepositoryId: job.githubRepositoryId,
      }),
      logger,
    },
    job,
  )
}
