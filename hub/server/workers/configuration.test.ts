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
      "learning.run",
      "learning.redact-review-comment",
      "synchronize-local-builds",
      "import-github-workflow-run",
    ])
    expect(jobProcessors.scheduled.map(({ name }) => name)).toContain("learning.recover-runs")
    expect(jobSchedules).toContainEqual(
      expect.objectContaining({
        id: "learning-run-recovery",
        repeat: { every: 60_000 },
      }),
    )
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
