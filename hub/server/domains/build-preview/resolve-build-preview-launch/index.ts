import { readPrivatePreviewAddress } from "../../../utils/read-private-preview-address/index.ts"
import type { ArtifactStorage } from "../../artifacts/create-artifact-storage/types.ts"
import { privatePreviewManifestPath } from "../../private-preview/types.ts"
import { reserveBuildPreviewBytes } from "../reserve-build-preview-bytes/index.ts"

const maximumManifestBytes = 256

interface LaunchDependencies {
  findArtifact(
    buildId: string,
    path: string,
  ): Promise<{ storageKey: string; byteLength: number } | null>
  storage: Pick<ArtifactStorage, "read">
}

function readCanonicalMount(bytes: Uint8Array): string | null {
  try {
    const marker: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (
      !marker ||
      typeof marker !== "object" ||
      !("basePath" in marker) ||
      typeof marker.basePath !== "string"
    ) {
      return null
    }
    const mount = readPrivatePreviewAddress(marker.basePath)?.address.mount
    return mount === marker.basePath ? mount : null
  } catch {
    return null
  }
}

export async function resolveBuildPreviewLaunch(
  buildId: string,
  page: string,
  dependencies: LaunchDependencies,
): Promise<{ status: "ok"; destination: string } | { status: "unavailable" }> {
  const marker = await dependencies.findArtifact(buildId, privatePreviewManifestPath)
  if (
    !marker ||
    !Number.isSafeInteger(marker.byteLength) ||
    marker.byteLength < 1 ||
    marker.byteLength > maximumManifestBytes
  ) {
    return { status: "ok", destination: page }
  }

  const release = reserveBuildPreviewBytes(marker.byteLength)
  if (!release) return { status: "unavailable" }
  try {
    const stored = await dependencies.storage.read(marker.storageKey)
    if (stored.status === "unavailable") return { status: "unavailable" }
    if (stored.status !== "ok" || stored.bytes.byteLength !== marker.byteLength) {
      return { status: "ok", destination: page }
    }
    const mount = readCanonicalMount(stored.bytes)
    if (!mount || page.startsWith(mount)) return { status: "ok", destination: page }

    // The file reader needs the slash at the mount root.
    const pathname = page.split(/[?#]/, 1)[0]!
    const tail = pathname === mount.slice(0, -1) ? page.slice(pathname.length) : page.slice(1)
    return { status: "ok", destination: `${mount}${tail}` }
  } finally {
    release()
  }
}
