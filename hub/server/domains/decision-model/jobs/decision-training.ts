import { z } from "zod"

export const decisionTrainingJob = {
  name: "decision.training",
  schema: z
    .object({
      repositoryId: z.uuid(),
      jobId: z.uuid(),
    })
    .strict(),
  options: {
    attempts: 289,
    backoff: { type: "fixed" as const, delay: 5 * 60_000 },
  },
}
