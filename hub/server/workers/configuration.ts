import { z } from "zod"

import { createLearningJobProcessors } from "../domains/learning/create-learning-job-processors/index.ts"
import { scheduledMaintenancePriority } from "../domains/learning/jobs/priorities.ts"
import { recoverLearningRunsJob } from "../domains/learning/jobs/recover-learning-runs.ts"
import { scheduleLearningRunsJob } from "../domains/learning/jobs/schedule-learning-runs.ts"
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
import { discoverGitHubWorkflowRunsJob } from "./discover-github-workflow-runs/index.ts"
import { importGitHubWorkflowRunJob } from "./import-github-workflow-run/index.ts"
import { recoverGitHubWebhookDeliveriesJob } from "./recover-github-webhook-deliveries/index.ts"
import { reconcileGitHubInstallation } from "./reconcile-github-installation/index.ts"
import { retryGitHubBuildsAwaitingImport } from "./retry-github-builds-awaiting-import/index.ts"

const learning = createLearningJobProcessors(process.env, logger)

const githubInstallationReconciliation: JobDefinition<Record<string, never>> = {
  name: "reconcile-github-installation",
  schema: z.object({}).strict(),
  options: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    priority: scheduledMaintenancePriority,
  },
}

const githubBuildImportRetry: JobDefinition<Record<string, never>> = {
  name: "retry-github-builds-awaiting-import",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
}

const githubWorkflowRunDiscovery: JobDefinition<Record<string, never>> = {
  name: "discover-github-workflow-runs",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 60_000 } },
}

// Runs every minute, so a failed run waits for the next one instead of retrying.
const githubWebhookRecovery: JobDefinition<Record<string, never>> = {
  name: "recover-github-webhook-deliveries",
  schema: z.object({}).strict(),
  options: { attempts: 1 },
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
    learning.scheduledRun,
    learning.recover,
    learning.schedule,
    createJobProcessor(githubInstallationReconciliation, reconcileGitHubInstallation),
    createJobProcessor(githubBuildImportRetry, retryGitHubBuildsAwaitingImport),
    createJobProcessor(githubWorkflowRunDiscovery, discoverGitHubWorkflowRunsJob),
    createJobProcessor(githubWebhookRecovery, recoverGitHubWebhookDeliveriesJob),
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
    id: "learning-run-daily",
    definition: scheduleLearningRunsJob,
    payload: {},
    repeat: { pattern: "0 2 * * *", tz: "UTC" },
  },
  {
    id: "github-installation-reconciliation",
    definition: githubInstallationReconciliation,
    payload: {},
    repeat: { every: 15 * 60 * 1_000 },
  },
  {
    id: "github-build-import-retry",
    definition: githubBuildImportRetry,
    payload: {},
    repeat: { every: 5 * 60 * 1_000 },
  },
  {
    id: "github-workflow-run-discovery",
    definition: githubWorkflowRunDiscovery,
    payload: {},
    repeat: { every: 5 * 60 * 1_000 },
  },
  {
    id: "github-webhook-recovery",
    definition: githubWebhookRecovery,
    payload: {},
    repeat: { every: 60_000 },
  },
]
