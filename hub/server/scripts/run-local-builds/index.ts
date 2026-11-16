import "dotenv/config"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { z } from "zod"

import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { synchronizeLocalBuilds } from "../../domains/local-builds/synchronize-local-builds/index.ts"
import { logger } from "../../integrations/pino/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"

export async function runLocalBuilds(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.NODE_ENV !== "development" || !isLocalDevelopmentDatabase(environment)) {
    throw new Error("Local Builds require NODE_ENV=development and a local development database.")
  }
  const prototypeRoot = z.string().trim().min(1).parse(environment.LOCAL_PROTOTYPE_ROOT)
  if (!path.isAbsolute(prototypeRoot)) {
    throw new Error("LOCAL_PROTOTYPE_ROOT must be an absolute directory.")
  }
  const actionRoot =
    environment.LOCAL_REPLICA_BUILD_ACTION_ROOT ??
    fileURLToPath(new URL("../../../../actions/build/", import.meta.url))
  const temporaryRoot = environment.LOCAL_BUILD_TEMPORARY_ROOT ?? tmpdir()
  if (!path.isAbsolute(actionRoot) || !path.isAbsolute(temporaryRoot)) {
    throw new Error("Local Build action and temporary directories must be absolute.")
  }
  const storage = await createConfiguredArtifactStorage(environment)
  const { prisma } = await import("../../integrations/prisma/index.ts")
  try {
    const summary = await synchronizeLocalBuilds({
      database: prisma,
      storage,
      prototypeRoot,
      actionRoot,
      temporaryRoot,
      logger,
    })
    logger.info(summary, "Local Build synchronization completed")
    return summary
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runLocalBuilds()
  } catch (error) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      "Local Build synchronization failed; check local mode, storage, Git, Docker, and build action dependencies",
    )
    process.exitCode = 1
  }
}
