import type {
  JobDefinition,
  JobProcessor,
  JobQueueName,
  JobScheduleRepeat,
} from "../integrations/bullmq/types.ts"

// Product processors and schedules are added here when their domains are built.
export const jobProcessors: Record<JobQueueName, JobProcessor[]> = {
  "on-demand": [],
  scheduled: [],
}

export const jobSchedules: {
  id: string
  definition: JobDefinition<unknown>
  payload: unknown
  repeat: JobScheduleRepeat
}[] = []
