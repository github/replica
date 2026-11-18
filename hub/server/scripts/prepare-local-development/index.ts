import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { prepareLocalDevelopment } from "../../domains/local-development/prepare-local-development/index.ts"
import { readLocalDevelopmentConfiguration } from "../../domains/local-development/read-local-development-configuration/index.ts"
import { logger } from "../../integrations/pino/index.ts"

export async function prepareLocalDevelopmentEntryPoint() {
  process.env.NODE_ENV ??= "development"
  process.env.HUB_LOCAL_MODE = "true"
  process.env.HUB_LOCAL_SIGN_IN = "true"
  const result = await prepareLocalDevelopment(readLocalDevelopmentConfiguration(process.env))
  logger.info(
    { root: result?.root, seeded: result?.seeded },
    "Hub local development preparation completed",
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await prepareLocalDevelopmentEntryPoint()
  } catch (error) {
    logger.fatal(
      { errorType: error instanceof Error ? error.name : "UnknownError" },
      error instanceof Error ? error.message : "Hub local development preparation failed.",
    )
    process.exitCode = 1
  }
}
