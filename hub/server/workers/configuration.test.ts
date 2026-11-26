import { UnrecoverableError } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import { reconcileGitHubInstallation } from "./reconcile-github-installation"
import { getJobProcessors, jobSchedules } from "./configuration"

vi.mock("./reconcile-github-installation", () => ({
  reconcileGitHubInstallation: vi.fn(),
}))

it("loads setup schedules and scheduled processors without validating the preview writer", async () => {
  vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_ENABLED", "true")
  vi.stubEnv("HUB_PRIVATE_PREVIEW_WRITE_REPOSITORY_ID", "not-a-repository-id")

  const configuration = await import("./configuration")
  expect(configuration.jobSchedules).toContainEqual(
    expect.objectContaining({ id: "github-build-import-retry" }),
  )
  expect(configuration.getJobProcessors("scheduled").map(({ name }) => name)).toContain(
    "retry-github-builds-awaiting-import",
  )
})

describe("learning worker configuration", () => {
  it("keeps learning and local Build work on their intended queues", () => {
    expect(getJobProcessors("on-demand").map(({ name }) => name)).toEqual([
      "deliver-analytics-event",
      "learning.run",
      "learning.redact-review-comment",
      "learning.delete-agent-screenshots",
      "synchronize-local-builds",
      "import-github-workflow-run",
    ])
    const scheduled = getJobProcessors("scheduled").map(({ name }) => name)
    expect(scheduled).toContain("learning.recover-runs")
    expect(scheduled).toEqual(
      expect.arrayContaining([
        "learning.run",
        "learning.schedule-runs",
        "learning.score-applied-learnings",
      ]),
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
    expect(scheduled).toContain("decision.recover-training")
    expect(scheduled).toContain("decision.reconcile-runtime-deletions")
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "decision-training-recovery",
        repeat: { every: 60_000 },
      }),
    )
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "decision-runtime-deletion-recovery",
        repeat: { every: 60_000 },
      }),
    )
  })
})

describe("analytics worker configuration", () => {
  it("uses scheduled recovery and retention without running external sends there", () => {
    const scheduled = getJobProcessors("scheduled").map(({ name }) => name)
    expect(scheduled).not.toContain("deliver-analytics-event")
    for (const id of ["analytics-delivery-recovery", "analytics-event-retention"]) {
      const schedule = jobSchedules.find((entry) => entry.id === id)
      expect(scheduled).toContain(schedule?.definition.name)
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
    const processor = getJobProcessors("scheduled").find(
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
      expect(getJobProcessors("scheduled").map(({ name }) => name)).toContain(
        schedule?.definition.name,
      )
    },
  )
})

describe("GitHub webhook recovery schedule", () => {
  it("checks for missed deliveries every minute without stacking retries", () => {
    const schedule = jobSchedules.find((candidate) => candidate.id === "github-webhook-recovery")
    expect(schedule?.repeat).toEqual({ every: 60_000 })
    expect(schedule?.definition.options).toEqual({ attempts: 1 })
    expect(getJobProcessors("scheduled").map(({ name }) => name)).toContain(
      schedule?.definition.name,
    )
  })
})
