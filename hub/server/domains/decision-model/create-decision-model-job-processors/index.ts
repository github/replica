import type { Logger } from "pino"

import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueRecoverableJob } from "../../../integrations/bullmq/enqueue-recoverable-job/index.ts"
import { listActiveDecisionTrainingJobs } from "../../../repositories/decision-training-jobs/list-active-decision-training-jobs/index.ts"
import { DecisionRuntimeError } from "../../../integrations/decision-runtime/create-decision-runtime-client/errors.ts"
import { decisionTrainingJob } from "../jobs/decision-training.ts"
import { recoverDecisionTrainingJobs } from "../jobs/recover-decision-training.ts"
import { processDecisionTrainingJob } from "../process-decision-training-job/index.ts"
import type { DecisionModelDependencies } from "../types.ts"

class DecisionTrainingPendingError extends Error {}

export function createDecisionModelJobProcessors(input: {
  databaseUrl: string
  dependencies: DecisionModelDependencies
  database: Parameters<typeof listActiveDecisionTrainingJobs>[0]
  logger: Logger
}) {
  const run = createJobProcessor(
    decisionTrainingJob,
    async (job) => {
      const result = await processDecisionTrainingJob(job, input.dependencies)
      if (!result.terminal) {
        throw new DecisionTrainingPendingError("Decision training is still running.")
      }
    },
    (error) =>
      error instanceof DecisionTrainingPendingError ||
      (error instanceof DecisionRuntimeError &&
        ["rate_limited", "timeout", "unavailable"].includes(error.code)),
  )
  const recover = createJobProcessor(recoverDecisionTrainingJobs, async () => {
    const queue = createJobQueue({
      name: "on-demand",
      databaseUrl: input.databaseUrl,
      logger: input.logger,
    })
    try {
      for (const job of await listActiveDecisionTrainingJobs(input.database)) {
        await enqueueRecoverableJob(
          queue,
          decisionTrainingJob,
          { repositoryId: job.repositoryId, jobId: job.id },
          `decision-training-${job.id}`,
        )
      }
    } finally {
      await queue.close()
    }
  })
  return { run, recover }
}
