import { UnrecoverableError } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import { reconcileGitHubInstallation } from "./reconcile-github-installation"
import { jobProcessors, jobSchedules } from "./configuration"

vi.mock("./reconcile-github-installation", () => ({
  reconcileGitHubInstallation: vi.fn(),
}))

describe("learning worker configuration", () => {
  it("keeps learning and local Build work on their intended queues", () => {
    expect(jobProcessors["on-demand"].map(({ name }) => name)).toEqual([
      "deliver-analytics-event",
      "learning.run",
      "learning.redact-review-comment",
      "synchronize-local-builds",
      "import-github-workflow-run",
    ])
    expect(jobProcessors.scheduled.map(({ name }) => name)).toContain("learning.recover-runs")
    expect(jobProcessors.scheduled.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["learning.run", "learning.schedule-runs"]),
    )
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "learning-run-recovery",
        repeat: { every: 60_000 },
      }),
    )
    const recovery = jobSchedules.find((schedule) => schedule.id === "learning-run-recovery")
    expect(recovery?.definition.options?.priority).toBe(1)
    const daily = jobSchedules.find((schedule) => schedule.id === "learning-run-daily")
    expect(daily?.definition.name).toBe("learning.schedule-runs")
    expect(daily?.definition.options).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      priority: 1,
    })
    expect(daily?.payload).toEqual({})
    expect(daily?.repeat).toEqual({ pattern: "0 2 * * *", tz: "UTC" })
    expect(jobProcessors.scheduled.map(({ name }) => name)).toContain("decision.recover-training")
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "decision-training-recovery",
        repeat: { every: 60_000 },
      }),
    )
  })
})

describe("analytics worker configuration", () => {
  it("uses scheduled recovery and retention without running external sends there", () => {
    expect(jobProcessors.scheduled.map(({ name }) => name)).not.toContain("deliver-analytics-event")
    for (const id of ["analytics-delivery-recovery", "analytics-event-retention"]) {
      const schedule = jobSchedules.find((entry) => entry.id === id)
      expect(jobProcessors.scheduled.map(({ name }) => name)).toContain(schedule?.definition.name)
    }
  })
})

describe("GitHub installation reconciliation schedule", () => {
  it("registers a 15-minute scheduled job with bounded retries", () => {
    const schedule = jobSchedules.find(
      (candidate) => candidate.id === "github-installation-reconciliation",
    )
    expect(schedule?.repeat).toEqual({ every: 15 * 60 * 1_000 })
    expect(schedule?.payload).toEqual({})
    expect(schedule?.definition.name).toBe("reconcile-github-installation")
    expect(schedule?.definition.options).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
      priority: 1,
    })
  })

  it("runs valid jobs and propagates reconciliation failures", async () => {
    const processor = jobProcessors.scheduled.find(
      (candidate) => candidate.name === "reconcile-github-installation",
    )!
    vi.mocked(reconcileGitHubInstallation).mockResolvedValueOnce()
    await expect(processor.process({})).resolves.toBeUndefined()
    expect(reconcileGitHubInstallation).toHaveBeenCalledOnce()

    const failure = new Error("reconciliation failed")
    vi.mocked(reconcileGitHubInstallation).mockRejectedValueOnce(failure)
    await expect(processor.process({})).rejects.toBe(failure)
    await expect(processor.process({ unexpected: true })).rejects.toBeInstanceOf(UnrecoverableError)
  })
})

describe("GitHub Build recovery schedules", () => {
  it.each(["github-build-import-retry", "github-workflow-run-discovery"])(
    "runs %s every five minutes",
    (id) => {
      const schedule = jobSchedules.find((candidate) => candidate.id === id)
      expect(schedule?.repeat).toEqual({ every: 5 * 60 * 1_000 })
      expect(jobProcessors.scheduled.map(({ name }) => name)).toContain(schedule?.definition.name)
    },
  )
})

describe("GitHub webhook recovery schedule", () => {
  it("checks for missed deliveries every minute without stacking retries", () => {
    const schedule = jobSchedules.find((candidate) => candidate.id === "github-webhook-recovery")
    expect(schedule?.repeat).toEqual({ every: 60_000 })
    expect(schedule?.definition.options).toEqual({ attempts: 1 })
    expect(jobProcessors.scheduled.map(({ name }) => name)).toContain(schedule?.definition.name)
  })
})
