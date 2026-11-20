import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GitHubBuildAuthorTargetError } from "../domains/github-builds/errors.ts"
import { GitHubCommitLookupError } from "../integrations/github/errors.ts"

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  repair: vi.fn(),
  check: vi.fn(),
  actions: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock("../domains/authentication/read-github-app-configuration/index.ts", () => ({
  readGitHubAppConfiguration: mocks.configuration,
}))
vi.mock("../domains/github-builds/repair-github-build-author/index.ts", () => ({
  repairGitHubBuildAuthor: mocks.repair,
}))
vi.mock("../domains/github-webhooks/check-github-webhook-communication/index.ts", () => ({
  checkGitHubWebhookCommunication: mocks.check,
}))
vi.mock("../integrations/github/create-github-actions-client/index.ts", () => ({
  createGitHubActionsClient: mocks.actions,
}))
vi.mock("../integrations/prisma/index.ts", () => ({
  prisma: { $disconnect: mocks.disconnect },
}))
vi.mock("../integrations/pino/index.ts", () => ({ logger: { warn: vi.fn() } }))

import { runGitHubWebhookCheck } from "./check-github-webhooks/run/index.ts"
import { runGitHubBuildAuthorRepair } from "./repair-github-build-author/run/index.ts"

const buildId = "00000000-0000-4000-8000-000000000001"

describe("GitHub maintenance commands", () => {
  let stdout: ReturnType<typeof vi.spyOn>
  let stderr: ReturnType<typeof vi.spyOn>
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
    process.exitCode = undefined
    vi.stubEnv("LOG_LEVEL", "silent")
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example")
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    mocks.configuration.mockReturnValue({
      appCredentials: { appId: "1", installationId: "2", privateKey: "synthetic-secret" },
    })
    mocks.actions.mockReturnValue({})
    mocks.disconnect.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it("prints the author repair preview even when operational logging is silent", async () => {
    mocks.repair.mockResolvedValue({
      status: "available",
      author: { providerUserId: "7", login: "mona", avatarUrl: null },
      build: "would-update",
      prototypeOwner: "unchanged",
    })

    await runGitHubBuildAuthorRepair(["--repository-id", "56", "--build-id", buildId])

    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        buildId,
        status: "available",
        author: { providerUserId: "7", login: "mona", avatarUrl: null },
        build: "would-update",
        prototypeOwner: "unchanged",
      })}\n`,
    )
    expect(mocks.repair).toHaveBeenCalledWith(expect.anything(), {
      githubRepositoryId: 56,
      buildId,
      apply: false,
    })
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(stderr).not.toHaveBeenCalled()
  })

  it("prints webhook check results independently of log level and reports failures", async () => {
    mocks.check.mockResolvedValue([{ name: "webhook_events", result: "fail", detail: "Missing." }])

    await runGitHubWebhookCheck(["--repository-id", "56", "--run-id", "7"])

    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        checks: [{ name: "webhook_events", result: "fail", detail: "Missing." }],
      })}\n`,
    )
    expect(process.exitCode).toBe(1)
  })

  it("reports safe usage without echoing invalid argument values", async () => {
    await runGitHubBuildAuthorRepair(["--synthetic-secret=private"])

    expect(stderr).toHaveBeenCalledWith(
      "Provide --repository-id and --build-id; add --apply only to save the repair.\n",
    )
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("synthetic-secret"))
    expect(process.exitCode).toBe(1)
  })

  it.each([
    [new GitHubBuildAuthorTargetError(), "No GitHub Build matches that repository and Build ID."],
    [new GitHubCommitLookupError(403), "GitHub commit lookup failed (HTTP 403)."],
    [new Error("synthetic-provider-secret"), "GitHub maintenance failed;"],
  ])("reports known safe errors and hides unexpected details", async (error, expected) => {
    mocks.repair.mockRejectedValue(error)

    await runGitHubBuildAuthorRepair(["--repository-id", "56", "--build-id", buildId])

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(expected))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("synthetic-provider-secret"))
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)
  })
})
