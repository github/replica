import { contentTypeForBuildPath } from "../../build-artifacts/content-type-for-build-path/index.ts"
import { normalizeBuildArtifactPath } from "../../build-artifacts/normalize-build-artifact-path/index.ts"
import { injectPreviewBridge } from "../inject-preview-bridge/index.ts"
import type {
  BuildPreviewFileResult,
  ReadBuildPreviewFileDependencies,
  ReadBuildPreviewFileInput,
} from "./types.ts"

export async function readBuildPreviewFile(
  input: ReadBuildPreviewFileInput,
  dependencies: ReadBuildPreviewFileDependencies,
): Promise<BuildPreviewFileResult> {
  let requestPath: string
  try {
    requestPath = decodeURIComponent(input.requestPath)
  } catch {
    return { status: "not-found" }
  }
  let path =
    requestPath === "/__replica/screenshots/desktop.png"
      ? "screenshots/desktop.png"
      : requestPath === "/__replica/screenshots/narrow.png"
        ? "screenshots/narrow.png"
        : `dist${requestPath === "/" ? "/index.html" : requestPath}`
  path = normalizeBuildArtifactPath(path) ?? ""
  let artifact = path ? await dependencies.findArtifact(input.buildId, path) : null
  if (!artifact && input.acceptsHtml && !requestPath.split("/").at(-1)?.includes(".")) {
    path = "dist/index.html"
    artifact = await dependencies.findArtifact(input.buildId, path)
  }
  if (!artifact) return { status: "not-found" }

  const stored = await dependencies.storage.read(artifact.storageKey)
  if (stored.status !== "ok") {
    return { status: stored.status === "not-found" ? "not-found" : "unavailable" }
  }

  const contentType = contentTypeForBuildPath(path)
  const html = contentType.startsWith("text/html")
  return {
    status: "ok",
    bytes: html ? injectPreviewBridge(stored.bytes) : stored.bytes,
    contentType,
    html,
  }
}
