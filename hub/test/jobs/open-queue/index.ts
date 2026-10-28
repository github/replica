import pino from "pino"
import { onTestFinished } from "vitest"

import { createJobQueue } from "../../../server/integrations/bullmq/create-job-queue/index.ts"
import type { JobQueueName } from "../../../server/integrations/bullmq/types.ts"
import { getDatabaseUrl } from "../../database/get-database-url/index.ts"

export function openQueue(name: JobQueueName, databaseUrl = getDatabaseUrl()) {
  const queue = createJobQueue({
    name,
    databaseUrl,
    logger: pino({ level: "silent" }),
  })
  onTestFinished(() => queue.close())
  return queue
}
