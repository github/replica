import type { Logger } from "pino"

import type { PrismaClient } from "../../generated/prisma/client.ts"
import type { ArtifactStorage } from "../artifacts/create-artifact-storage/types.ts"

export interface GitHubBuildImportDependencies {
  database: PrismaClient
  storage: ArtifactStorage
  logger: Pick<Logger, "info" | "warn">
}
