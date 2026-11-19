import { describe, expect, it } from "vitest"
import { z } from "zod"

import { openQueue } from "../../../../test/jobs/open-queue"
import { enqueueJob } from "../../../integrations/bullmq/enqueue-job"
import { automaticLearningRunPriority, scheduledMaintenancePriority } from "../jobs/priorities"
import { reprioritizeScheduledLearningJobs } from "."

describe("reprioritizeScheduledLearningJobs()", () => {
  it("moves legacy automatic jobs behind scheduled maintenance before workers start", async () => {
    const queue = openQueue("scheduled")
    const automatic = await enqueueJob(
      queue,
      {
        name: "learning.run",
        schema: z.object({ runId: z.uuid() }),
      },
      { runId: "11111111-1111-4111-8111-111111111111" },
      { jobId: "legacy-automatic" },
    )
    const maintenance = await enqueueJob(
      queue,
      {
        name: "learning.recover-runs",
        schema: z.object({}),
      },
      {},
      { jobId: "maintenance", priority: scheduledMaintenancePriority },
    )
    expect(automatic.priority).toBe(0)
    expect(maintenance.priority).toBe(scheduledMaintenancePriority)

    await reprioritizeScheduledLearningJobs(queue)

    expect((await queue.getJob(automatic.id!))?.priority).toBe(automaticLearningRunPriority)
    expect((await queue.getJob(maintenance.id!))?.priority).toBe(scheduledMaintenancePriority)
  })
})
