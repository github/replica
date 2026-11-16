import type { JobDefinition, JobQueue } from "../types.ts"
import { enqueueJob } from "../enqueue-job/index.ts"

export async function enqueueRecoverableJob<T>(
  queue: JobQueue,
  definition: JobDefinition<T>,
  payload: T,
  jobId: string,
) {
  const existing = await queue.getJob(jobId)
  if (existing) {
    const state = await existing.getState()
    if (state === "failed" || state === "completed") {
      await existing.remove()
    } else {
      return existing
    }
  }
  return enqueueJob(queue, definition, payload, { jobId })
}
