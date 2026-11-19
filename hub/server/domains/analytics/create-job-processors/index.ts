import type { Logger } from "pino"
import { z } from "zod"

import { createJobProcessor } from "../../../integrations/bullmq/create-job-processor/index.ts"
import { createJobQueue } from "../../../integrations/bullmq/create-job-queue/index.ts"
import { enqueueJob } from "../../../integrations/bullmq/enqueue-job/index.ts"
import type { JobDefinition } from "../../../integrations/bullmq/types.ts"
import { clearExpiredAnalyticsAuthorizations } from "../../../repositories/analytics/authorization-store/index.ts"
import {
  clearExpiredAnalyticsEvents,
  createAnalyticsDeliveryProcessor,
  recoverAnalyticsDeliveries,
} from "../deliver/index.ts"
import { readAnalyticsSettings } from "../read-settings/index.ts"

const deliverJob = {
  name: "deliver-analytics-event",
  schema: z.strictObject({ deliveryId: z.uuid() }),
}
export const recoverAnalyticsJob: JobDefinition<Record<string, never>> = {
  name: "recover-analytics-deliveries",
  schema: z.strictObject({}),
}
export const clearAnalyticsJob: JobDefinition<Record<string, never>> = {
  name: "clear-expired-analytics-events",
  schema: z.strictObject({}),
}

export function createAnalyticsJobProcessors(environment: NodeJS.ProcessEnv, logger: Logger) {
  return {
    deliver: createJobProcessor(deliverJob, async ({ deliveryId }) => {
      const settings = readAnalyticsSettings(environment)
      if (!settings?.outboundEnabled) return
      const { prisma } = await import("../../../integrations/prisma/index.ts")
      await createAnalyticsDeliveryProcessor(prisma, settings)(deliveryId)
    }),
    recover: createJobProcessor(recoverAnalyticsJob, async () => {
      const settings = readAnalyticsSettings(environment)
      if (!settings?.outboundEnabled || !environment.DATABASE_URL) return
      const { prisma } = await import("../../../integrations/prisma/index.ts")
      const queue = createJobQueue({
        name: "on-demand",
        databaseUrl: environment.DATABASE_URL,
        logger,
      })
      try {
        await recoverAnalyticsDeliveries(prisma, (deliveryId) =>
          enqueueJob(queue, deliverJob, { deliveryId }),
        )
      } finally {
        await queue.close()
      }
    }),
    clear: createJobProcessor(clearAnalyticsJob, async () => {
      const { prisma } = await import("../../../integrations/prisma/index.ts")
      await clearExpiredAnalyticsAuthorizations(prisma)
      return clearExpiredAnalyticsEvents(prisma)
    }),
  }
}
