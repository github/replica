import type { JobsOptions, PostgresConnectionOptions, PostgresQueueBackend, Queue } from "bullmq"
import type { Logger } from "pino"
import type { z } from "zod"

export type JobQueueName = "on-demand" | "scheduled"

export interface JobConnection {
  name: JobQueueName
  databaseUrl: string
  logger: Logger
}

export interface JobDefinition<T> {
  name: string
  schema: z.ZodType<T>
  options?: Pick<JobsOptions, "attempts" | "backoff" | "priority">
}

export interface JobProcessor {
  name: string
  process: (payload: unknown) => Promise<unknown>
}

export type JobQueue = Queue<
  unknown,
  unknown,
  string,
  unknown,
  unknown,
  string,
  PostgresQueueBackend,
  PostgresConnectionOptions
>

export type JobScheduleRepeat = { every: number } | { pattern: string; tz: string }
