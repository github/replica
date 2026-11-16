import "dotenv/config"

import { getLocalBuildJobDefinition } from "../../domains/local-builds/get-local-build-job-definition/index.ts"
import { createJobQueue } from "../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../integrations/bullmq/enqueue-job/index.ts"
import { logger } from "../../integrations/pino/index.ts"
import { isLocalDevelopmentDatabase } from "../../utils/is-local-development-database/index.ts"

if (
  process.env.NODE_ENV !== "development" ||
  !isLocalDevelopmentDatabase(process.env) ||
  !process.env.LOCAL_PROTOTYPE_ROOT
) {
  throw new Error(
    "Queued local Builds require development mode, a local database, and LOCAL_PROTOTYPE_ROOT.",
  )
}
const queue = createJobQueue({
  name: "on-demand",
  databaseUrl: process.env.DATABASE_URL!,
  logger,
})
try {
  const job = await enqueueJob(queue, getLocalBuildJobDefinition(), {})
  console.log(`Queued local Build synchronization ${job.id}.`)
} finally {
  await queue.close()
}
