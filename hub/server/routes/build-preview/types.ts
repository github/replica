import type { ArtifactStorage } from "../../domains/artifacts/create-artifact-storage/types.ts"
import type { BuildPreviewTarget } from "../../repositories/build-artifacts/find-build-preview-target/index.ts"

export interface BuildPreviewRouteDependencies {
  applicationOrigin: string
  previewBaseOrigin: string
  encryptionKey: Buffer
  storage: ArtifactStorage
  bridgeSource: string
  reviewBridgeSource?: string
  findTargetById(
    buildId: string,
    target: BuildPreviewTarget,
  ): Promise<{
    buildId: string
    startPage: string
    artifactPath: string
  } | null>
  findArtifact(
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
  readAvailableShareLink?(
    shareLinkId: string,
    buildId: string,
  ): Promise<{ expiresAt: Date; startPage: string } | null>
  restoreSession?(sessionDigest: string): Promise<object | null>
}
