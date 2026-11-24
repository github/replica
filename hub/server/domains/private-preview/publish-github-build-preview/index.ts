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
import { declaresPreviewMount } from "../../build-preview/declares-preview-mount/index.ts"
import type { GitHubBuildImportDependencies } from "../../github-builds/types.ts"
import {
  maximumPrivatePreviewFileBytes,
  maximumPrivatePreviewManifestBytes,
  previewStorageKeyPattern,
  privatePreviewManifestPath,
} from "../types.ts"

const publicationBatchSize = 4
type PublicationReason =
  | "database-error"
  | "invalid-package"
  | "source-missing"
  | "source-mismatch"
  | "source-unavailable"
  | "destination-conflict"
  | "destination-unavailable"

class PublicationError extends Error {
  readonly reason: PublicationReason

  constructor(reason: PublicationReason) {
    super(`Private preview publication failed: ${reason}.`)
    this.reason = reason
  }
}

async function inBatches<Input, Output>(
  items: readonly Input[],
  run: (item: Input) => Promise<Output>,
) {
  const results: Output[] = []
  for (let offset = 0; offset < items.length; offset += publicationBatchSize) {
    // Let in-flight operations settle before returning a failure to the job runner.
    const batch = await Promise.allSettled(
      items.slice(offset, offset + publicationBatchSize).map(run),
    )
    for (const result of batch) {
      if (result.status === "rejected") throw result.reason
      results.push(result.value)
    }
  }
  return results
}

export async function publishGitHubBuildPreview(
  { database, logger, storage, privatePreviewWriter }: GitHubBuildImportDependencies,
  buildId: string,
  address: PrivatePreviewAddress,
) {
  if (privatePreviewWriter?.repositoryId !== address.repositoryId) return
  let stage: "read-target" | "verify-source" | "copy-files" | "mark-ready" = "read-target"
  try {
    const target = await findPrivatePreviewTarget(database, address, "pending")
    if (target?.buildId !== buildId) return
    const snapshot = await readPendingPrivatePreviewPackage(database, buildId)
    if (!snapshot) return

    stage = "verify-source"
    const dist = snapshot.artifacts.filter(({ kind }) => kind === "dist")
    const marker = dist.find(({ path }) => path === privatePreviewManifestPath)
    if (
      !marker ||
      marker.byteLength < 1 ||
      marker.byteLength > maximumPrivatePreviewManifestBytes ||
      dist.length > maximumDistFiles ||
      dist.reduce((total, { byteLength }) => total + byteLength, 0) > maximumDistBytes
    ) {
      throw new PublicationError("invalid-package")
    }

    const files = await inBatches(
      snapshot.artifacts,
      async ({ kind, path, storageKey, byteLength }) => {
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
          throw new PublicationError("invalid-package")
        }
        const source = await storage.read(storageKey)
        if (source.status === "not-found") throw new PublicationError("source-missing")
        if (source.status === "unavailable") throw new PublicationError("source-unavailable")
        if (source.status !== "ok" || source.bytes.byteLength !== byteLength) {
          throw new PublicationError("source-mismatch")
        }
        if (
          path === privatePreviewManifestPath &&
          !declaresPreviewMount(source.bytes, address.mount)
        ) {
          throw new PublicationError("source-mismatch")
        }
        return { kind, path, storageKey, bytes: Buffer.from(source.bytes) }
      },
    )
    if (digestDistFiles(files) !== snapshot.distDigest) {
      throw new PublicationError("source-mismatch")
    }

    const destination = privatePreviewWriter.storage
    stage = "copy-files"
    await inBatches(
      files.filter(({ kind, path }) => kind === "dist" && path !== privatePreviewManifestPath),
      async ({ storageKey, bytes }) => {
        const result = await destination.write(storageKey, bytes)
        if (result.status === "already-exists") {
          const existing = await destination.read(storageKey)
          if (existing.status !== "ok") throw new PublicationError("destination-unavailable")
          if (!bytes.equals(existing.bytes)) throw new PublicationError("destination-conflict")
        } else if (result.status !== "ok") {
          throw new PublicationError("destination-unavailable")
        }
      },
    )
    stage = "mark-ready"
    const current = await findPrivatePreviewTarget(database, address, "pending")
    if (
      current?.buildId === buildId &&
      (await markPrivatePreviewReady(database, buildId, BigInt(address.runId)))
    ) {
      logger.info({ buildId, runId: address.runId }, "Private preview published")
    }
  } catch (error) {
    const failure =
      error instanceof PublicationError
        ? error
        : new PublicationError(
            stage === "verify-source"
              ? "source-unavailable"
              : stage === "copy-files"
                ? "destination-unavailable"
                : "database-error",
          )
    logger.warn(
      { buildId, runId: address.runId, stage, reason: failure.reason },
      "Private preview publication failed; the ordinary Build is still available",
    )
    throw failure
  }
}
