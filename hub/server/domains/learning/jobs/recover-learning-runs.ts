import { z } from "zod"

export const recoverLearningRunsJob = {
  name: "learning.recover-runs",
  schema: z.object({}).strict(),
  options: { attempts: 3, backoff: { type: "exponential", delay: 5_000 } },
}
