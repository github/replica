import { z } from "zod"

import { createLearningJobProcessors } from "../domains/learning/create-learning-job-processors/index.ts"
import { recoverLearningRunsJob } from "../domains/learning/jobs/recover-learning-runs.ts"
import { getGitHubWorkflowRunJobDefinition } from "../domains/github-builds/get-github-workflow-run-job-definition/index.ts"
import { getLocalBuildJobDefinition } from "../domains/local-builds/get-local-build-job-definition/index.ts"
import { createJobProcessor } from "../integrations/bullmq/create-job-processor/index.ts"
import type {
  JobDefinition,
  JobProcessor,
  JobQueueName,
  JobScheduleRepeat,
} from "../integrations/bullmq/types.ts"
import { logger } from "../integrations/pino/index.ts"
import { importGitHubWorkflowRunJob } from "./import-github-workflow-run/index.ts"
import { reconcileGitHubInstallation } from "./reconcile-github-installation/index.ts"

const learning = createLearningJobProcessors(process.env, logger)

const githubInstallationReconciliation: JobDefinition<Record<string, never>> = {
  name: "reconcile-github-installation",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
}

export const jobProcessors: Record<JobQueueName, JobProcessor[]> = {
  "on-demand": [
    learning.run,
    learning.redact,
    createJobProcessor(getLocalBuildJobDefinition(), async () => {
      const { runLocalBuilds } = await import("../scripts/run-local-builds/index.ts")
      return await runLocalBuilds()
    }),
    createJobProcessor(getGitHubWorkflowRunJobDefinition(), importGitHubWorkflowRunJob),
  ],
  scheduled: [
    learning.recover,
    createJobProcessor(githubInstallationReconciliation, reconcileGitHubInstallation),
  ],
}

export const jobSchedules: {
  id: string
  definition: JobDefinition<unknown>
  payload: unknown
  repeat: JobScheduleRepeat
}[] = [
  {
    id: "learning-run-recovery",
    definition: recoverLearningRunsJob,
    payload: {},
    repeat: { every: 60_000 },
  },
  {
    id: "github-installation-reconciliation",
    definition: githubInstallationReconciliation,
    payload: {},
    repeat: { every: 60 * 60 * 1_000 },
  },
]
