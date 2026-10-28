import { describe, expect, it } from "vitest"
import { z } from "zod"

import { openQueue } from "../../../../test/jobs/open-queue"
import { upsertJobSchedule } from "."

describe("upsertJobSchedule()", () => {
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
