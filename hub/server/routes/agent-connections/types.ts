import type { ArtifactStorage } from "../../domains/artifacts/create-artifact-storage/types.ts"

export interface AgentConnectionRouteDependencies {
  applicationOrigin: string
  databaseUrl: string
  /** Where Hub keeps agent screenshots; without it Hub refuses them. */
  artifactStorage?: ArtifactStorage
  learning: {
    cliPath: string
    learningDatabaseUrl?: string
    nodePath: string
    root: string
    staticDirectories: string[]
  }
}
