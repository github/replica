import { z } from "zod"

export function getLocalBuildJobDefinition() {
  return {
    name: "synchronize-local-builds",
    schema: z.object({}).strict(),
    options: { attempts: 2, backoff: { type: "fixed" as const, delay: 5_000 } },
  }
}
