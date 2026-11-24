import { findPrivatePreviewTarget } from "../../../repositories/private-previews/find-private-preview-target/index.ts"
import { markPrivatePreviewReady } from "../../../repositories/private-previews/mark-private-preview-ready/index.ts"
import { readPendingPrivatePreviewPackage } from "../../../repositories/private-previews/read-pending-private-preview-package/index.ts"
import type { PrivatePreviewAddress } from "../../../utils/private-preview-address/index.ts"
import {
  maximumDistBytes,
  maximumDistFiles,
  maximumDistPathDepth,
  maximumTemplateManifestBytes,
} from "../../build-artifacts/constants.ts"
import { digestDistFiles } from "../../build-artifacts/digest-dist-files/index.ts"
import { normalizeBuildArtifactPath } from "../../build-artifacts/normalize-build-artifact-path/index.ts"
import type { BuildPackageFile } from "../../build-artifacts/types.ts"
import { declaresPreviewMount } from "../../build-preview/declares-preview-mount/index.ts"
import type { GitHubBuildImportDependencies } from "../../github-builds/types.ts"
import {
  maximumPrivatePreviewFileBytes,
  maximumPrivatePreviewManifestBytes,
  previewStorageKeyPattern,
  privatePreviewManifestPath,
} from "../types.ts"

export async function publishGitHubBuildPreview(
  { database, logger, storage, privatePreviewWriter }: GitHubBuildImportDependencies,
  buildId: string,
  address: PrivatePreviewAddress,
) {
  if (privatePreviewWriter?.repositoryId !== address.repositoryId) return
  const target = await findPrivatePreviewTarget(database, address, "pending")
  if (target?.buildId !== buildId) return
  const snapshot = await readPendingPrivatePreviewPackage(database, buildId)
  if (!snapshot) return

  let stage = "verify-source"
  try {
    const dist = snapshot.artifacts.filter(({ kind }) => kind === "dist")
    const marker = dist.find(({ path }) => path === privatePreviewManifestPath)
    if (
      !marker ||
      marker.byteLength < 1 ||
      marker.byteLength > maximumPrivatePreviewManifestBytes ||
      dist.length > maximumDistFiles ||
      dist.reduce((total, { byteLength }) => total + byteLength, 0) > maximumDistBytes
    ) {
      throw new Error("The private preview package metadata is invalid.")
    }

    const files: (BuildPackageFile & { storageKey: string })[] = []
    for (const { kind, path, storageKey, byteLength } of snapshot.artifacts) {
      const validFile =
        kind === "dist"
          ? path.startsWith("dist/") &&
            normalizeBuildArtifactPath(path) === path &&
            path.split("/").length - 1 <= maximumDistPathDepth &&
            byteLength <= maximumPrivatePreviewFileBytes
          : kind === "manifest" &&
            path === "templates.json" &&
            byteLength <= maximumTemplateManifestBytes
      if (!validFile || !previewStorageKeyPattern.test(storageKey) || byteLength < 0) {
        throw new Error("The private preview package metadata is invalid.")
      }
      const source = await storage.read(storageKey)
      if (source.status !== "ok" || source.bytes.byteLength !== byteLength) {
        throw new Error("A private preview source file is missing or unreadable.")
      }
      if (
        path === privatePreviewManifestPath &&
        !declaresPreviewMount(source.bytes, address.mount)
      ) {
        throw new Error("The private preview base does not match the owning run.")
      }
      files.push({ kind, path, storageKey, bytes: Buffer.from(source.bytes) })
    }
    if (digestDistFiles(files) !== snapshot.distDigest) {
      throw new Error("The private preview package does not match the imported dist digest.")
    }

    const destination = privatePreviewWriter.storage
    stage = "copy-files"
    for (const { kind, path, storageKey, bytes } of files) {
      if (kind !== "dist" || path === privatePreviewManifestPath) continue
      const result = await destination.write(storageKey, bytes)
      if (result.status === "already-exists") {
        const existing = await destination.read(storageKey)
        if (existing.status !== "ok" || !bytes.equals(existing.bytes)) {
          throw new Error("The private preview destination could not verify existing bytes.")
        }
      } else if (result.status !== "ok") {
        throw new Error(`The private preview destination rejected a write: ${result.status}.`)
      }
    }
    stage = "mark-ready"
    const current = await findPrivatePreviewTarget(database, address, "pending")
    if (
      current?.buildId === buildId &&
      (await markPrivatePreviewReady(database, buildId, BigInt(address.runId)))
    ) {
      logger.info({ buildId, runId: address.runId }, "Private preview published")
    }
  } catch (error) {
    logger.warn(
      { buildId, runId: address.runId, stage },
      "Private preview publication failed; the ordinary Build is still available",
    )
    throw error
  }
}
