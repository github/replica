import type { Logger } from "pino"

import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import {
  getGitHubWorkflowRunJobDefinition,
  type GitHubWorkflowRunJob,
} from "../get-github-workflow-run-job-definition/index.ts"

/**
 * Recovery uses one job ID per run, so repeated passes never stack duplicate imports
 * while one is waiting or active, and a finished or exhausted job is replaced.
 */
export async function enqueueGitHubWorkflowRunRetries(
  connection: { databaseUrl: string; logger: Logger },
  jobs: readonly GitHubWorkflowRunJob[],
) {
  if (jobs.length === 0) return
  const queue = createJobQueue({ name: "on-demand", ...connection })
  try {
    for (const job of jobs) {
      await enqueueRecoverableJob(
        queue,
        getGitHubWorkflowRunJobDefinition(),
        job,
        `github-workflow-run-retry-${job.runId}`,
      )
    }
  } finally {
    await queue.close()
  }
}
