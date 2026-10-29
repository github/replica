export interface StoredArtifact {
  key: string
  created: boolean
}

export interface ArtifactStorage {
  put(contentDigest: string, bytes: Uint8Array): Promise<StoredArtifact>
  read(key: string): Promise<Uint8Array>
  remove(key: string): Promise<void>
}
