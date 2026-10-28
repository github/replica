import { createPostgresBackend, UnrecoverableError, Worker } from "bullmq"
import type { JobProgress, PostgresConnectionOptions, PostgresQueueBackend } from "bullmq"
import { z } from "zod"

import { getJobConnection } from "../get-job-connection/index.ts"
import type { JobConnection, JobProcessor } from "../types.ts"

export function createJobWorker({
  name,
  databaseUrl,
  logger,
  processors,
  concurrency = 1,
}: JobConnection & { processors: JobProcessor[]; concurrency?: number }) {
  z.enum(["on-demand", "scheduled"]).parse(name)
  z.number().int().min(1).max(100).parse(concurrency)
  const handlers = new Map(processors.map((processor) => [processor.name, processor]))
  if (handlers.size !== processors.length) {
    throw new Error("Job processor names must be unique within a worker.")
  }

  const worker = new Worker<
    unknown,
    unknown,
    string,
    PostgresQueueBackend,
    JobProgress,
    PostgresConnectionOptions
  >(
    name,
    async (job) => {
      const processor = handlers.get(job.name)
      if (!processor) throw new UnrecoverableError("Job name is not registered for this worker.")
      return await processor.process(job.data)
    },
    { connection: getJobConnection(databaseUrl), concurrency, autorun: false },
    createPostgresBackend,
  )
  worker.on("error", (error) =>
    logger.error({ queue: name, errorType: error.name }, "Job worker connection failed"),
  )
  worker.on("failed", (job, error) => {
    logger.error(
      {
        queue: name,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        errorType: error.name,
      },
      "Job attempt failed",
    )
  })
  worker.on("completed", (job) => {
    logger.info(
      { queue: name, jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade },
      "Job completed",
    )
  })
  return worker
}
