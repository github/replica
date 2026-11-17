import { describe, expect, it } from "vitest"

import { jobProcessors, jobSchedules } from "./configuration"

describe("learning worker configuration", () => {
  it("keeps learning and local Build work on their intended queues", () => {
    expect(jobProcessors["on-demand"].map(({ name }) => name)).toEqual([
      "learning.run",
      "learning.redact-review-comment",
      "synchronize-local-builds",
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
