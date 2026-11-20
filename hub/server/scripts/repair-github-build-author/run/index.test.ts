import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GitHubBuildAuthorTargetError } from "../../../domains/github-builds/errors"
import { GitHubCommitLookupError } from "../../../integrations/github/errors"

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  repair: vi.fn(),
  actions: vi.fn(),
  disconnect: vi.fn(),
}))
vi.mock("../../../domains/authentication/read-github-app-configuration", () => ({
  readGitHubAppConfiguration: mocks.configuration,
}))
vi.mock("../../../domains/github-builds/repair-github-build-author", () => ({
  repairGitHubBuildAuthor: mocks.repair,
}))
vi.mock("../../../integrations/github/create-github-actions-client", () => ({
  createGitHubActionsClient: mocks.actions,
}))
vi.mock("../../../integrations/prisma", () => ({
  prisma: { $disconnect: mocks.disconnect },
}))
vi.mock("../../../integrations/pino", () => ({ logger: { warn: vi.fn() } }))

import { runGitHubBuildAuthorRepair } from "."

const buildId = "00000000-0000-4000-8000-000000000001"

describe("runGitHubBuildAuthorRepair()", () => {
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
    process.exitCode = undefined
    vi.stubEnv("LOG_LEVEL", "silent")
    mocks.configuration.mockReturnValue({
      appCredentials: { appId: "1", installationId: "2", privateKey: "synthetic-secret" },
    })
    mocks.actions.mockReturnValue({})
    mocks.disconnect.mockResolvedValue(undefined)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it("prints the author repair preview even when operational logging is silent", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
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

  it("reports safe usage without echoing invalid argument values", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

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
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
    mocks.repair.mockRejectedValue(error)

    await runGitHubBuildAuthorRepair(["--repository-id", "56", "--build-id", buildId])

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(expected))
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("synthetic-provider-secret"))
    expect(mocks.disconnect).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)
  })
})
