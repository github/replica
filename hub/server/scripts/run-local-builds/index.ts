import "dotenv/config"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createConfiguredArtifactStorage } from "../../domains/artifacts/create-configured-artifact-storage/index.ts"
import { LocalBuildPreconditionError } from "../../domains/local-builds/errors.ts"
import { synchronizeLocalBuilds } from "../../domains/local-builds/synchronize-local-builds/index.ts"
import { prepareLocalDevelopment } from "../../domains/local-development/prepare-local-development/index.ts"
import { readLocalDevelopmentConfiguration } from "../../domains/local-development/read-local-development-configuration/index.ts"
import { logger } from "../../integrations/pino/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"
import { presentLocalBuildFailure } from "./present-local-build-failure/index.ts"

export async function runLocalBuilds(
  environment: NodeJS.ProcessEnv = process.env,
  options: { disconnect?: boolean } = {},
) {
  if (!isLocalDevelopmentDatabase(environment)) {
    throw new LocalBuildPreconditionError("Local Builds require a local development database.")
  }
  const localDevelopment = readLocalDevelopmentConfiguration(environment)
  if (!localDevelopment.enabled) {
    throw new LocalBuildPreconditionError("Local Builds require HUB_LOCAL_MODE=true.")
  }
  await prepareLocalDevelopment(localDevelopment)
  const storage = await createConfiguredArtifactStorage(environment)
  const { prisma } = await import("../../integrations/prisma/index.ts")
  try {
    const summary = await synchronizeLocalBuilds({
      database: prisma,
      storage,
      prototypeRoot: localDevelopment.root,
      actionRoot: localDevelopment.buildActionDirectory,
      temporaryRoot: localDevelopment.temporaryRoot,
      logger,
    })
    logger.info(summary, "Local Build synchronization completed")
    return summary
  } finally {
    if (options.disconnect) await prisma.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.env.NODE_ENV ??= "development"
    process.env.HUB_LOCAL_MODE = "true"
    await runLocalBuilds(process.env, { disconnect: true })
  } catch (error) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      presentLocalBuildFailure(error),
    )
    process.exitCode = 1
  }
}
