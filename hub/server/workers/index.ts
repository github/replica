import "dotenv/config"
import { z } from "zod"

import { logger } from "../integrations/pino/index.ts"
import { jobProcessors } from "./configuration.ts"
import { runJobWorker } from "./run-job-worker/index.ts"

try {
  const name = z.enum(["on-demand", "scheduled"]).parse(process.argv[2])
  const databaseUrl = z.string().min(1).parse(process.env.DATABASE_URL)
  const variable = name === "on-demand" ? "ON_DEMAND_JOB_CONCURRENCY" : "SCHEDULED_JOB_CONCURRENCY"
  const concurrency = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(process.env[variable] ?? 1)
  await runJobWorker({ name, databaseUrl, concurrency, logger, processors: jobProcessors[name] })
} catch (error) {
  logger.fatal(
    { errorType: error instanceof Error ? error.name : "UnknownError" },
    "Job worker failed; check database access, worker configuration, and shutdown time",
  )
  process.exit(1)
}
