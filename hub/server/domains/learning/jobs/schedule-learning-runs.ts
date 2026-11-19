import { z } from "zod"

import { scheduledMaintenancePriority } from "./priorities.ts"

export const scheduleLearningRunsJob = {
  name: "learning.schedule-runs",
  schema: z.object({}).strict(),
  options: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    priority: scheduledMaintenancePriority,
  },
}
