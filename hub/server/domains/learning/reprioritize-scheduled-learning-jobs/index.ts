import type { JobQueue } from "../../../integrations/bullmq/types.ts"
import { automaticLearningRunPriority } from "../jobs/priorities.ts"
import { learningRunJob } from "../jobs/learning-run.ts"

export async function reprioritizeScheduledLearningJobs(queue: JobQueue) {
  for (const state of ["waiting", "prioritized"] as const) {
    for (const job of await queue.getJobs(state, 0, -1, true)) {
      if (job.name === learningRunJob.name && job.priority !== automaticLearningRunPriority) {
        await job.changePriority({ priority: automaticLearningRunPriority })
      }
    }
  }
}
