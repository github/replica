import { getLocalBuildJobDefinition } from "../domains/local-builds/get-local-build-job-definition/index.ts"
import { createJobProcessor } from "../integrations/bullmq/create-job-processor/index.ts"
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
  "on-demand": [
    learning.run,
    learning.redact,
    createJobProcessor(getLocalBuildJobDefinition(), async () => {
      const { runLocalBuilds } = await import("../scripts/run-local-builds/index.ts")
      return await runLocalBuilds()
    }),
  ],
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
