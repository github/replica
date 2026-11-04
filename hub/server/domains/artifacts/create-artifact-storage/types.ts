export type ArtifactStorageSettings =
  | { provider: "filesystem"; directory: string }
  | {
      provider: "azure-blob"
      accountUrl: string
      container: string
      managedIdentityClientId?: string
    }

export type ArtifactReadResult =
  | { status: "ok"; bytes: Uint8Array }
  | { status: "invalid-key" | "too-large" | "not-found" | "unavailable" }

export type ArtifactWriteResult = {
  status: "ok" | "invalid-key" | "too-large" | "already-exists" | "unavailable"
}

export type ArtifactDeleteResult = {
  status: "ok" | "invalid-key" | "not-found" | "unavailable"
}

export interface ArtifactStorage {
  isReady(): Promise<boolean>
  read(key: string): Promise<ArtifactReadResult>
  write(key: string, bytes: Uint8Array): Promise<ArtifactWriteResult>
  delete(key: string): Promise<ArtifactDeleteResult>
}
