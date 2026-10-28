import { createPostgresBackend, Queue } from "bullmq"
import { z } from "zod"

import { getJobConnection } from "../get-job-connection/index.ts"
import type { JobConnection, JobQueue } from "../types.ts"

export function createJobQueue({ name, databaseUrl, logger }: JobConnection): JobQueue {
  z.enum(["on-demand", "scheduled"]).parse(name)
  const queue: JobQueue = new Queue(
    name,
    {
      connection: getJobConnection(databaseUrl),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
      },
    },
    createPostgresBackend,
  )
  queue.on("error", (error) =>
    logger.error({ queue: name, errorType: error.name }, "Job queue connection failed"),
  )
  return queue
}
