import "dotenv/config"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { z } from "zod"

import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { localDeveloperIdentity } from "../../utils/local-developer-identity/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"
import {
  seedPrototypeIndexData,
  seededBuildArtifactBytes,
  seededBuildArtifacts,
} from "./seed-prototype-index-data/index.ts"

if (!isLocalDevelopmentDatabase(process.env)) {
  throw new Error("The prototype seed requires a local development database.")
}
const requestedUserId = process.argv[2] ? z.uuid().parse(process.argv[2]) : undefined
const { prisma } = await import("../../integrations/prisma/index.ts")
// Local sign-in creates one known identity, so the seed can find it without asking.
const userId =
  requestedUserId ??
  (
    await prisma.externalIdentity.findUnique({
      where: { provider_issuer_subject: localDeveloperIdentity },
      select: { userId: true },
    })
  )?.userId
if (!userId) {
  await prisma.$disconnect()
  throw new Error("Sign in as the local developer first, or pass a Hub user ID.")
}

try {
  const provider = process.env.ARTIFACT_STORAGE_PROVIDER
  if (provider === "filesystem") {
    process.env.ARTIFACT_STORAGE_DIRECTORY ??= resolve("storage/artifacts")
    await mkdir(process.env.ARTIFACT_STORAGE_DIRECTORY, { recursive: true })
  }
  if (provider) {
    const storage = await createConfiguredArtifactStorage(process.env)
    for (const artifact of seededBuildArtifacts) {
      const bytes = seededBuildArtifactBytes.get(artifact.storageKey)!
      const result = await storage.write(artifact.storageKey, bytes)
      if (result.status !== "ok" && result.status !== "already-exists") {
        throw new Error(`Could not seed artifact ${artifact.path}: ${result.status}.`)
      }
    }
  }
  await seedPrototypeIndexData(prisma, userId, Boolean(provider))
  console.log("The local prototype index seed is ready.")
} finally {
  await prisma.$disconnect()
}
