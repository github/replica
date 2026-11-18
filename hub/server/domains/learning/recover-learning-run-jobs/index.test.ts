import { describe, expect, it, vi } from "vitest"

import { recoverLearningRunJobs } from "."

describe("recoverLearningRunJobs()", () => {
  it("returns user and automatic runs to their original queues in recovery order", async () => {
    const enqueueOnDemand = vi.fn().mockResolvedValue(undefined)
    const enqueueScheduled = vi.fn().mockResolvedValue(undefined)

    await recoverLearningRunJobs({
      list: vi.fn().mockResolvedValue([
        { id: "user-run", scheduled: false },
        { id: "automatic-run", scheduled: true },
      ]),
      enqueueOnDemand,
      enqueueScheduled,
    })

    expect(enqueueOnDemand).toHaveBeenCalledWith("user-run")
    expect(enqueueScheduled).toHaveBeenCalledWith("automatic-run")
    expect(enqueueOnDemand.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueueScheduled.mock.invocationCallOrder[0]!,
    )
  })
})
