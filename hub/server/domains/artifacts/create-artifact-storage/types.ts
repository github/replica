export type ArtifactStorageSettings =
  | { provider: "filesystem"; directory: string }
  | {
      provider: "azure-blob"
      accountUrl: string
      container: string
      managedIdentityClientId?: string
    }

export type ArtifactFailure = {
  status: "invalid-key" | "too-large" | "not-found" | "already-exists" | "unavailable"
}

export interface ArtifactStorage {
  read(key: string): Promise<{ status: "ok"; bytes: Uint8Array } | ArtifactFailure>
  write(key: string, bytes: Uint8Array): Promise<{ status: "ok" } | ArtifactFailure>
  delete(key: string): Promise<{ status: "ok" } | ArtifactFailure>
}
