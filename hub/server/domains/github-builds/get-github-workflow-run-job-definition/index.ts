import { z } from "zod"

import type { JobDefinition } from "../../../integrations/bullmq/types.ts"

export interface GitHubWorkflowRunJob {
  githubRepositoryId: number
  runId: number
}

export function getGitHubWorkflowRunJobDefinition(): JobDefinition<GitHubWorkflowRunJob> {
  return {
    name: "import-github-workflow-run",
    schema: z
      .object({
        githubRepositoryId: z.number().int().positive(),
        runId: z.number().int().positive(),
      })
      .strict(),
    options: { attempts: 5, backoff: { type: "exponential", delay: 15_000 } },
  }
}
