import { z } from "zod"

import { automaticLearningRunPriority } from "./priorities.ts"

export const proposeLearningUpdatesJob = {
  name: "learning.propose-updates",
  schema: z.object({}).strict(),
  options: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    priority: automaticLearningRunPriority,
  },
}
