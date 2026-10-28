import type { JobsOptions } from "bullmq"

import { parseJobPayload } from "../parse-job-payload/index.ts"
import type { JobDefinition, JobQueue } from "../types.ts"

export async function enqueueJob<T>(
  queue: JobQueue,
  definition: JobDefinition<T>,
  payload: T,
  options: Pick<JobsOptions, "delay" | "priority" | "jobId"> = {},
) {
  const data = parseJobPayload(definition, payload)
  return await queue.add(definition.name, data, { ...definition.options, ...options })
}
