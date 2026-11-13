import type {
  JobDefinition,
  JobProcessor,
  JobQueueName,
  JobScheduleRepeat,
} from "../integrations/bullmq/types.ts"
import { createLearningJobProcessors } from "../domains/learning/create-learning-job-processors/index.ts"
import { recoverLearningRunsJob } from "../domains/learning/jobs/recover-learning-runs.ts"
import { logger } from "../integrations/pino/index.ts"

const learning = createLearningJobProcessors(process.env, logger)

export const jobProcessors: Record<JobQueueName, JobProcessor[]> = {
  "on-demand": [learning.run, learning.redact],
  scheduled: [learning.recover],
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
]
