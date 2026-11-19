import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { createGitHubActionsClient } from "../../../integrations/github/create-github-actions-client/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"

export interface ImportGitHubWorkflowRunDependencies {
  database: PrismaClient
  storage: ArtifactStorage
  client: Pick<
    ReturnType<typeof createGitHubActionsClient>,
    "getWorkflowRun" | "listRunArtifacts" | "downloadArtifact"
  >
  logger: Pick<Logger, "info" | "warn">
}

export interface ImportGitHubWorkflowRunResult {
  dist: "ignored" | "pending" | "imported" | "unchanged" | "failed"
  screenshots: "absent" | "attached" | "not-ready" | "digest-mismatch" | "invalid"
}
