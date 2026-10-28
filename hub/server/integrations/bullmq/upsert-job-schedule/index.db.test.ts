import { describe, expect, it } from "vitest"
import { z } from "zod"

import { openQueue } from "../../../../test/jobs/open-queue"
import type { JobDefinition, JobScheduleRepeat } from "../types"
import { upsertJobSchedule } from "."

describe("upsertJobSchedule()", () => {
  it("rejects the on-demand queue and malformed schedules without storing jobs", async () => {
    const scheduled = openQueue("scheduled")
    const onDemand = openQueue("on-demand")
    const definition: JobDefinition<unknown> = {
      name: "validated-schedule",
      schema: z.object({ count: z.number().int().positive() }),
    }

    await expect(
      upsertJobSchedule(onDemand, {
        id: "wrong-queue",
        definition,
        payload: { count: 1 },
        repeat: { every: 100 },
      }),
    ).rejects.toThrow()
    const invalidRepeats: JobScheduleRepeat[] = [
      { every: 0 },
      { every: -1 },
      { every: 1.5 },
      { every: Number.NaN },
      { pattern: "not a cron expression", tz: "UTC" },
      { pattern: "0 * * * *", tz: "Not/A-Timezone" },
    ]
    for (const repeat of invalidRepeats) {
      await expect(
        upsertJobSchedule(scheduled, {
          id: "invalid-repeat",
          definition,
          payload: { count: 1 },
          repeat,
        }),
      ).rejects.toThrow()
    }
    await expect(
      upsertJobSchedule(scheduled, {
        id: "invalid-payload",
        definition,
        payload: { count: "invalid" },
        repeat: { every: 100 },
      }),
    ).rejects.toThrow()

    expect(await scheduled.getJobSchedulersCount()).toBe(0)
    expect(await onDemand.getJobSchedulersCount()).toBe(0)
    expect(await scheduled.getJobCountByTypes("waiting", "delayed")).toBe(0)
  }, 15_000)
})
