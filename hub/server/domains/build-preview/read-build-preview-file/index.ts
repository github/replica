import { contentTypeForBuildPath } from "../../build-artifacts/content-type-for-build-path/index.ts"
import { normalizeBuildArtifactPath } from "../../build-artifacts/normalize-build-artifact-path/index.ts"
import { injectPreviewBridge } from "../inject-preview-bridge/index.ts"
import { readTemplateScreenshotPath } from "../template-screenshot-path/index.ts"
import type {
  BuildPreviewFileResult,
  ReadBuildPreviewFileDependencies,
  ReadBuildPreviewFileInput,
} from "./types.ts"

function readDeclaredRoutePathnames(bytes: Uint8Array): string[] {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== "object" || !("templates" in value)) return []
    const templates = value.templates
    if (!Array.isArray(templates)) return []
    return templates.flatMap((template) => {
      if (!template || typeof template !== "object" || !("path" in template)) return []
      const path = (template as Record<string, unknown>).path
      if (typeof path !== "string") return []
      try {
        return [decodeURIComponent(new URL(path, "http://preview.invalid").pathname)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

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
  if (
    input.distOnly &&
    (requestPath === "/__replica/screenshots/desktop.png" ||
      requestPath === "/__replica/screenshots/narrow.png")
  ) {
    return { status: "not-found" }
  }
  let path =
    readTemplateScreenshotPath(input.requestPath) ??
    (requestPath === "/__replica/screenshots/narrow.png"
      ? "screenshots/narrow.png"
      : `dist${
          requestPath === "/"
            ? "/index.html"
            : requestPath.endsWith("/")
              ? `${requestPath}index.html`
              : requestPath
        }`)
  const normalizedPath = normalizeBuildArtifactPath(path)
  if (!normalizedPath) return { status: "not-found" }
  path = normalizedPath
  let artifact = await dependencies.findArtifact(input.buildId, path)
  let useSpaFallback = input.acceptsHtml && !requestPath.split("/").at(-1)?.includes(".")
  if (!artifact && input.acceptsHtml && !useSpaFallback) {
    const manifest = await dependencies.findArtifact(input.buildId, "templates.json")
    if (manifest) {
      const storedManifest = await dependencies.storage.read(manifest.storageKey)
      if (storedManifest.status !== "ok") {
        return {
          status: storedManifest.status === "not-found" ? "not-found" : "unavailable",
        }
      }
      useSpaFallback = readDeclaredRoutePathnames(storedManifest.bytes).includes(requestPath)
    }
  }
  if (!artifact && useSpaFallback) {
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
