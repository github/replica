import type { JobQueue } from "../../../integrations/bullmq/types.ts"
import { reprioritizeJobs } from "../../../integrations/bullmq/reprioritize-jobs/index.ts"
import { automaticLearningRunPriority } from "../jobs/priorities.ts"
import { learningRunJob } from "../jobs/learning-run.ts"

export async function reprioritizeScheduledLearningJobs(queue: JobQueue) {
  await reprioritizeJobs(queue, {
    name: learningRunJob.name,
    priority: automaticLearningRunPriority,
  })
}
