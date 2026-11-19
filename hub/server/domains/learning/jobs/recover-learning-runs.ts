import { z } from "zod"

import { scheduledMaintenancePriority } from "./priorities.ts"

export const recoverLearningRunsJob = {
  name: "learning.recover-runs",
  schema: z.object({}).strict(),
  options: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    priority: scheduledMaintenancePriority,
  },
}
