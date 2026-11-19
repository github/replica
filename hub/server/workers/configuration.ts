import { z } from "zod"

import {
  clearAnalyticsJob,
  createAnalyticsJobProcessors,
  recoverAnalyticsJob,
} from "../domains/analytics/create-job-processors/index.ts"
import { createLearningJobProcessors } from "../domains/learning/create-learning-job-processors/index.ts"
import { recoverLearningRunsJob } from "../domains/learning/jobs/recover-learning-runs.ts"
import { getLocalBuildJobDefinition } from "../domains/local-builds/get-local-build-job-definition/index.ts"
import { createJobProcessor } from "../integrations/bullmq/create-job-processor/index.ts"
import type {
  JobDefinition,
  JobProcessor,
  JobQueueName,
  JobScheduleRepeat,
} from "../integrations/bullmq/types.ts"
import { logger } from "../integrations/pino/index.ts"
import { reconcileGitHubInstallation } from "./reconcile-github-installation/index.ts"

const learning = createLearningJobProcessors(process.env, logger)
const analytics = createAnalyticsJobProcessors(process.env, logger)

const githubInstallationReconciliation: JobDefinition<Record<string, never>> = {
  name: "reconcile-github-installation",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
}

export const jobProcessors: Record<JobQueueName, JobProcessor[]> = {
  "on-demand": [
    analytics.deliver,
    learning.run,
    learning.redact,
    createJobProcessor(getLocalBuildJobDefinition(), async () => {
      const { runLocalBuilds } = await import("../scripts/run-local-builds/index.ts")
      return await runLocalBuilds()
    }),
  ],
  scheduled: [
    analytics.recover,
    analytics.clear,
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
    id: "analytics-delivery-recovery",
    definition: recoverAnalyticsJob,
    payload: {},
    repeat: { every: 60_000 },
  },
  {
    id: "analytics-event-retention",
    definition: clearAnalyticsJob,
    payload: {},
    repeat: { every: 60 * 60 * 1_000 },
  },
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
