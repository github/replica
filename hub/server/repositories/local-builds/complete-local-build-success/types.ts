export interface StoredBuildArtifact {
  path: string
  kind: "dist" | "screenshot" | "manifest"
  storageKey: string
  byteLength: number
}
