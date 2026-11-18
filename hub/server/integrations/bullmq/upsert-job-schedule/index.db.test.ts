import { describe, expect, it } from "vitest"
import { z } from "zod"

import { openQueue } from "../../../../test/jobs/open-queue"
import { upsertJobSchedule } from "."

describe("upsertJobSchedule()", () => {
  it("updates one stable scheduler instead of duplicating it", async () => {
    const scheduled = openQueue("scheduled")
    const definition = {
      name: "daily-learning",
      schema: z.object({ generation: z.number().int().positive() }),
      options: { attempts: 3 },
    }

    await upsertJobSchedule(scheduled, {
      id: "daily-learning",
      definition,
      payload: { generation: 1 },
      repeat: { pattern: "0 2 * * *", tz: "UTC" },
    })
    await upsertJobSchedule(scheduled, {
      id: "daily-learning",
      definition,
      payload: { generation: 2 },
      repeat: { pattern: "0 3 * * *", tz: "UTC" },
    })

    expect(await scheduled.getJobSchedulersCount()).toBe(1)
    await expect(scheduled.getJobScheduler("daily-learning")).resolves.toMatchObject({
      pattern: "0 3 * * *",
    })
  }, 15_000)

  it("rejects recurring work on the on-demand queue without storing jobs", async () => {
    const onDemand = openQueue("on-demand")
    const definition = {
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
    expect(await onDemand.getJobSchedulersCount()).toBe(0)
    expect(await onDemand.getJobCountByTypes("waiting", "delayed")).toBe(0)
  }, 15_000)
})
