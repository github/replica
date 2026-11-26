import { z } from "zod"

import { automaticLearningRunPriority } from "./priorities.ts"

export const proposeLearningUpdateJob = {
  name: "learning.propose-update",
  schema: z.object({ requestId: z.uuid() }).strict(),
  options: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000 },
    priority: automaticLearningRunPriority,
  },
}
