import { UnrecoverableError } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import { reconcileGitHubInstallation } from "./reconcile-github-installation"
import { jobProcessors, jobSchedules } from "./configuration"

vi.mock("./reconcile-github-installation", () => ({
  reconcileGitHubInstallation: vi.fn(),
}))

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
