import type { Logger } from "pino"

import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../integrations/bullmq/enqueue-job/index.ts"
import {
  getGitHubWorkflowRunJobDefinition,
  type GitHubWorkflowRunJob,
} from "../get-github-workflow-run-job-definition/index.ts"

/**
 * Each delivery gets its own job, so an event arriving while an earlier import of the
 * same run is active still triggers a later pass. Imports are idempotent per run.
 */
export async function enqueueGitHubWorkflowRunImport(
  connection: { databaseUrl: string; logger: Logger },
  job: GitHubWorkflowRunJob,
  deliveryId: string,
) {
  const queue = createJobQueue({ name: "on-demand", ...connection })
  try {
    await enqueueJob(queue, getGitHubWorkflowRunJobDefinition(), job, {
      jobId: `github-workflow-run-${deliveryId}`,
    })
  } finally {
    await queue.close()
  }
}
