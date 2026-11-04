export interface FilesystemArtifactStorage {
  isReady(signal: AbortSignal): Promise<boolean>
  read(
    key: string,
  ): Promise<
    { status: "ok"; bytes: Uint8Array } | { status: "not-found" | "unavailable" | "too-large" }
  >
  write(
    key: string,
    bytes: Uint8Array,
  ): Promise<{ status: "ok" | "already-exists" | "unavailable" }>
  delete(key: string): Promise<{ status: "ok" | "not-found" | "unavailable" }>
}
