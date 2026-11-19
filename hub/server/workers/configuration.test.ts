import { UnrecoverableError } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import { reconcileGitHubInstallation } from "./reconcile-github-installation"
import { pollConfiguredHostedBuilds } from "./poll-hosted-builds"
import { jobProcessors, jobSchedules } from "./configuration"

vi.mock("./reconcile-github-installation", () => ({
  reconcileGitHubInstallation: vi.fn(),
}))
vi.mock("./poll-hosted-builds", () => ({
  pollConfiguredHostedBuilds: vi.fn(),
}))

describe("learning worker configuration", () => {
  it("keeps learning and local Build work on their intended queues", () => {
    expect(jobProcessors["on-demand"].map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "learning.run",
        "learning.redact-review-comment",
        "synchronize-local-builds",
      ]),
    )
    expect(jobProcessors.scheduled.map(({ name }) => name)).toContain("learning.recover-runs")
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "learning-run-recovery",
        repeat: { every: 60_000 },
      }),
    )
  })

  describe("analytics worker configuration", () => {
    it("uses scheduled recovery and retention without running external sends there", () => {
      expect(jobProcessors["on-demand"].map(({ name }) => name)).toContain(
        "deliver-analytics-event",
      )
      expect(jobProcessors.scheduled.map(({ name }) => name)).not.toContain(
        "deliver-analytics-event",
      )
      for (const id of ["analytics-delivery-recovery", "analytics-event-retention"]) {
        const schedule = jobSchedules.find((entry) => entry.id === id)
        expect(jobProcessors.scheduled.map(({ name }) => name)).toContain(schedule?.definition.name)
      }
    })
  })
})

describe("GitHub installation reconciliation schedule", () => {
  it("registers an hourly scheduled job with bounded retries", () => {
    const schedule = jobSchedules.find(
      (candidate) => candidate.id === "github-installation-reconciliation",
    )
    expect(schedule?.repeat).toEqual({ every: 60 * 60 * 1_000 })
    expect(schedule?.payload).toEqual({})
    expect(schedule?.definition.name).toBe("reconcile-github-installation")
    expect(schedule?.definition.options).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 60_000 },
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

it("schedules the hosted poll every five minutes and uses its processor", async () => {
  const schedule = jobSchedules.find((candidate) => candidate.id === "hosted-build-poll")!
  expect(schedule.repeat).toEqual({ every: 5 * 60_000 })
  expect(jobProcessors["on-demand"].map(({ name }) => name)).not.toContain(schedule.definition.name)
  const scheduled = jobProcessors.scheduled.find(({ name }) => name === schedule.definition.name)!
  await scheduled.process(schedule.payload)
  expect(pollConfiguredHostedBuilds).toHaveBeenCalledOnce()
})
