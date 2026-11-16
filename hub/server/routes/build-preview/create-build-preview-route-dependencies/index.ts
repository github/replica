import { z } from "zod"

import type { ArtifactStorage } from "../../../domains/artifacts/create-artifact-storage/types.ts"
import { hostedPreviewBridgeSource } from "../../../assets/hosted-preview-bridge.ts"
import { prisma } from "../../../integrations/prisma/index.ts"
import { findBuildArtifact } from "../../../repositories/build-artifacts/find-build-artifact/index.ts"
import { findBuildPreviewTarget } from "../../../repositories/build-artifacts/find-build-preview-target/index.ts"
import type { BuildPreviewRouteDependencies } from "../types.ts"

const environmentSchema = z.object({
  HUB_APPLICATION_ORIGIN: z.url(),
  HUB_PREVIEW_ORIGIN: z.url(),
  HUB_AUTHENTICATION_ENCRYPTION_KEY: z.string().min(1),
})

export function createBuildPreviewRouteDependencies(
  environment: NodeJS.ProcessEnv,
  storage: ArtifactStorage,
): BuildPreviewRouteDependencies {
  const parsed = environmentSchema.parse(environment)
  const applicationOrigin = new URL(parsed.HUB_APPLICATION_ORIGIN)
  const previewBaseOrigin = new URL(parsed.HUB_PREVIEW_ORIGIN)
  for (const [name, origin] of [
    ["HUB_APPLICATION_ORIGIN", applicationOrigin],
    ["HUB_PREVIEW_ORIGIN", previewBaseOrigin],
  ] as const) {
    if (
      origin.origin !== parsed[name] ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      !["http:", "https:"].includes(origin.protocol)
    ) {
      throw new Error(`${name} must be an exact HTTP origin without a trailing slash.`)
    }
  }
  if (previewBaseOrigin.hostname === applicationOrigin.hostname) {
    throw new Error("HUB_PREVIEW_ORIGIN must use a separate wildcard hostname.")
  }
  if (
    previewBaseOrigin.protocol !== "https:" &&
    !previewBaseOrigin.hostname.endsWith(".localhost")
  ) {
    throw new Error("HUB_PREVIEW_ORIGIN must use HTTPS outside localhost development.")
  }
  const encryptionKey = Buffer.from(parsed.HUB_AUTHENTICATION_ENCRYPTION_KEY, "base64")
  if (encryptionKey.length !== 32) {
    throw new Error("HUB_AUTHENTICATION_ENCRYPTION_KEY must decode to exactly 32 bytes.")
  }
  return {
    applicationOrigin: applicationOrigin.origin,
    previewBaseOrigin: previewBaseOrigin.origin,
    encryptionKey,
    storage,
    bridgeSource: hostedPreviewBridgeSource,
    findTargetById: (buildId, target) => findBuildPreviewTarget(prisma, { buildId, target }),
    findArtifact: (buildId, path) => findBuildArtifact(prisma, buildId, path),
  }
}
