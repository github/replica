import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"

export interface ReadBuildPreviewFileInput {
  acceptsHtml: boolean
  buildId: string
  requestPath: string
}

export interface ReadBuildPreviewFileDependencies {
  storage: ArtifactStorage
  findArtifact(
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
}

export type BuildPreviewFileResult =
  | { status: "not-found" }
  | { status: "unavailable" }
  | {
      status: "ok"
      bytes: Uint8Array
      contentType: string
      html: boolean
    }
