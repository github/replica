import { z } from "zod"

export const scoreAppliedLearningsJob = {
  name: "learning.score-applied-learnings",
  schema: z
    .object({
      repositoryId: z.uuid(),
      commitSha: z.string().regex(/^[0-9a-f]{40}$/),
    })
    .strict(),
  options: { attempts: 3, backoff: { type: "fixed", delay: 60_000 } },
}
