import { z } from "zod"

import { createJobProcessor } from "../integrations/bullmq/create-job-processor/index.ts"
import type {
  JobDefinition,
  JobProcessor,
  JobQueueName,
  JobScheduleRepeat,
} from "../integrations/bullmq/types.ts"
import { reconcileGitHubInstallation } from "./reconcile-github-installation/index.ts"

const githubInstallationReconciliation: JobDefinition<Record<string, never>> = {
  name: "reconcile-github-installation",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
}

export const jobProcessors: Record<JobQueueName, JobProcessor[]> = {
  "on-demand": [],
  scheduled: [createJobProcessor(githubInstallationReconciliation, reconcileGitHubInstallation)],
}

export const jobSchedules: {
  id: string
  definition: JobDefinition<unknown>
  payload: unknown
  repeat: JobScheduleRepeat
}[] = [
  {
    id: "github-installation-reconciliation",
    definition: githubInstallationReconciliation,
    payload: {},
    repeat: { every: 60 * 60 * 1_000 },
  },
]
