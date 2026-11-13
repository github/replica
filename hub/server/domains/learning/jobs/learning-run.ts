import { z } from "zod"

export const learningRunJob = {
  name: "learning.run",
  schema: z.object({ runId: z.uuid() }).strict(),
  options: { attempts: 120, backoff: { type: "fixed", delay: 30_000 } },
}
