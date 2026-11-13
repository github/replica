import { describe, expect, it, vi } from "vitest"

import { claimLearningRun } from "."

describe("claimLearningRun()", () => {
  it("claims only queued runs and reports whether this worker won", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
    const database = { learningRun: { updateMany } }
    const startedAt = new Date("2026-11-13T10:00:00Z")

    await expect(claimLearningRun(database, "run-1", startedAt)).resolves.toBe(true)
    await expect(claimLearningRun(database, "run-1", startedAt)).resolves.toBe(false)
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "run-1", state: "QUEUED" },
      data: { state: "RUNNING", startedAt },
    })
  })
})
