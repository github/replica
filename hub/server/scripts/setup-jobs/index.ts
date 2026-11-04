import "dotenv/config"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"

import { createJobQueue } from "../../integrations/bullmq/create-job-queue/index.ts"
import { migrateJobDatabase } from "../../integrations/bullmq/migrate-job-database/index.ts"
import { upsertJobSchedule } from "../../integrations/bullmq/upsert-job-schedule/index.ts"
import { logger } from "../../integrations/pino/index.ts"
import { jobSchedules } from "../../workers/configuration.ts"

export async function setupJobs() {
  const databaseUrl = z.string().min(1).parse(process.env.DATABASE_URL)
  const schemaVersion = await migrateJobDatabase(databaseUrl)
  const queue = createJobQueue({ name: "scheduled", databaseUrl, logger })
  try {
    for (const schedule of jobSchedules) {
      await upsertJobSchedule(queue, schedule)
    }
  } finally {
    await queue.close()
  }
  logger.info({ schemaVersion, scheduleCount: jobSchedules.length }, "Job setup completed")
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await setupJobs()
  } catch {
    logger.fatal("Job setup failed; check database access, schema permissions, and schedules")
    process.exitCode = 1
  }
}
