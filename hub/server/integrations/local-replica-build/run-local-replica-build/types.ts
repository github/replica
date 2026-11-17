export interface LocalReplicaBuildInput {
  repositoryPath: string
  commitSha: string
  actionRoot: string
  temporaryRoot: string
  executionTimeoutMs?: number
}

export interface LocalReplicaBuildResult {
  packageDirectory: string
  cleanup(): Promise<void>
}

export type LocalReplicaBuildRunner = (
  input: LocalReplicaBuildInput,
) => Promise<LocalReplicaBuildResult>
