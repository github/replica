import { z } from "zod"

export const deleteAgentScreenshotsJob = {
  name: "learning.delete-agent-screenshots",
  schema: z
    .object({
      repositoryId: z.uuid(),
      grantId: z.string().min(1).max(255),
    })
    .strict(),
  options: { attempts: 120, backoff: { type: "fixed", delay: 30_000 } },
}
