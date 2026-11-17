import { describe, expect, it } from "vitest"

import { jobProcessors, jobSchedules } from "./configuration"

describe("learning worker configuration", () => {
  it("keeps explicit runs and redactions on demand and recovery on the scheduled queue", () => {
    expect(jobProcessors["on-demand"].map(({ name }) => name)).toEqual([
      "learning.run",
      "learning.redact-review-comment",
    ])
    expect(jobProcessors.scheduled.map(({ name }) => name)).toEqual(["learning.recover-runs"])
    expect(jobSchedules).toEqual([
      expect.objectContaining({
        id: "learning-run-recovery",
        repeat: { every: 60_000 },
      }),
    ])
  })
})
