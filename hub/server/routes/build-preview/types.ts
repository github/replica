import type { ArtifactStorage } from "../../domains/artifacts/create-artifact-storage/types.ts"

export interface BuildPreviewRouteDependencies {
  applicationOrigin: string
  previewBaseOrigin?: string
  encryptionKey: Buffer
  storage: ArtifactStorage
  bridgeSource: string
  reviewBridgeSource?: string
  findArtifact(
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
  readAvailableShareLink?(
    shareLinkId: string,
    buildId: string,
  ): Promise<{ expiresAt: Date; startPage: string; hosted?: true } | null>
  findPathTargets?(
    repositoryId: string,
    workflowRunId: string,
  ): Promise<{ buildId: string; repository: { id: string; local: boolean }; template: boolean }[]>
}
