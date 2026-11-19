import { describe, expect, it } from "vitest"
import { z } from "zod"

import { openQueue } from "../../../../test/jobs/open-queue"
import { enqueueJob } from "../enqueue-job"
import { enqueueRecoverableJob } from "."

describe("enqueueRecoverableJob()", () => {
  it("upgrades a retained waiting job from default to automatic priority", async () => {
    const queue = openQueue("scheduled")
    const definition = {
      name: "recover-priority",
      schema: z.object({ value: z.number() }),
    }
    const existing = await enqueueJob(
      queue,
      definition,
      { value: 1 },
      { jobId: "legacy-automatic" },
    )

    await expect(
      enqueueRecoverableJob(queue, definition, { value: 1 }, "legacy-automatic", { priority: 10 }),
    ).resolves.toMatchObject({ id: existing.id })

    const updated = await queue.getJob("legacy-automatic")
    expect(updated?.priority).toBe(10)
    expect(await updated?.getState()).toBe("prioritized")
  })
})
