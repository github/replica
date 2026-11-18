import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { getLocalBuildJobDefinition } from "../../domains/local-builds/get-local-build-job-definition/index.ts"
import { prepareLocalDevelopment } from "../../domains/local-development/prepare-local-development/index.ts"
import { readLocalDevelopmentConfiguration } from "../../domains/local-development/read-local-development-configuration/index.ts"
import { createJobQueue } from "../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../integrations/bullmq/enqueue-job/index.ts"
import { logger } from "../../integrations/pino/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"

export async function enqueueLocalBuilds(environment: NodeJS.ProcessEnv = process.env) {
  if (!isLocalDevelopmentDatabase(environment)) {
    throw new Error("Queued local Builds require a local development database.")
  }
  const localDevelopment = readLocalDevelopmentConfiguration(environment)
  if (!localDevelopment.enabled) throw new Error("Queued local Builds require HUB_LOCAL_MODE=true.")
  await prepareLocalDevelopment(localDevelopment)
  const queue = createJobQueue({
    name: "on-demand",
    databaseUrl: environment.DATABASE_URL!,
    logger,
  })
  try {
    const job = await enqueueJob(queue, getLocalBuildJobDefinition(), {})
    console.log(`Queued local Build synchronization ${job.id}.`)
  } finally {
    await queue.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.NODE_ENV ??= "development"
  process.env.HUB_LOCAL_MODE = "true"
  await enqueueLocalBuilds()
}
