import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  check: vi.fn(),
}))
vi.mock("../../../domains/authentication/read-github-app-configuration", () => ({
  readGitHubAppConfiguration: mocks.configuration,
}))
vi.mock("../../../domains/github-webhooks/check-github-webhook-communication", () => ({
  checkGitHubWebhookCommunication: mocks.check,
}))

import { runGitHubWebhookCheck } from "."

describe("runGitHubWebhookCheck()", () => {
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
    process.exitCode = undefined
    vi.stubEnv("LOG_LEVEL", "silent")
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example")
    mocks.configuration.mockReturnValue({
      appCredentials: { appId: "1", installationId: "2", privateKey: "synthetic-secret" },
    })
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it("prints webhook check results independently of log level and reports failures", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    mocks.check.mockResolvedValue([{ name: "webhook_events", result: "fail", detail: "Missing." }])

    await runGitHubWebhookCheck(["--repository-id", "56", "--run-id", "7"])

    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        checks: [{ name: "webhook_events", result: "fail", detail: "Missing." }],
      })}\n`,
    )
    expect(process.exitCode).toBe(1)
  })

  it("hides unexpected diagnostic errors", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    mocks.check.mockRejectedValue(new Error("synthetic-provider-secret"))

    await runGitHubWebhookCheck(["--repository-id", "56", "--run-id", "7"])

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("GitHub maintenance failed;"))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("synthetic-provider-secret"))
    expect(process.exitCode).toBe(1)
  })
})
