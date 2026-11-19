import { describe, expect, it, vi } from "vitest"

import type { JobQueue } from "../types"
import { reprioritizeJobs } from "."

describe("reprioritizeJobs()", () => {
  it("updates every matching queued job across pages without changing other work", async () => {
    const targetJobs = Array.from({ length: 102 }, (_, index) => ({
      name: "learning.run",
      priority: index === 100 ? 7 : 0,
      changePriority: vi.fn(({ priority }: { priority: number }) => {
        targetJobs[index]!.priority = priority
        return Promise.resolve()
      }),
    }))
    const otherJob = {
      name: "learning.recover-runs",
      priority: 1,
      changePriority: vi.fn(),
    }
    const jobsByState = {
      waiting: [otherJob, ...targetJobs.slice(0, 101)],
      prioritized: [targetJobs[101]!],
    }
    const queue = {
      getJobs: vi.fn((state: keyof typeof jobsByState, start: number, end: number) =>
        Promise.resolve(jobsByState[state].slice(start, end + 1)),
      ),
    } as unknown as JobQueue

    await reprioritizeJobs(queue, { name: "learning.run", priority: 7 })

    expect(targetJobs.every((job) => job.priority === 7)).toBe(true)
    expect(otherJob.changePriority).not.toHaveBeenCalled()
  })
})
