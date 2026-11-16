import type { Logger } from "pino"

import type { PrismaClient } from "../../../generated/prisma/client.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import type { LocalRepositoryDiscovery } from "../../../integrations/git/discover-local-repositories/types.ts"
import type { LocalReplicaBuildRunner } from "../../../integrations/local-replica-build/run-local-replica-build/types.ts"

export interface SynchronizeLocalBuildsInput {
  database: PrismaClient
  storage: ArtifactStorage
  prototypeRoot: string
  actionRoot: string
  temporaryRoot: string
  logger: Logger
  discover?: (root: string) => Promise<LocalRepositoryDiscovery>
  runBuild?: LocalReplicaBuildRunner
}

export interface LocalBuildSynchronizationSummary {
  repositories: number
  branches: number
  queued: number
  unchanged: number
  successful: number
  failed: number
  discoveryFailures: number
}
