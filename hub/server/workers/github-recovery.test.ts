import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import { discoverGitHubWorkflowRuns } from "../domains/github-builds/discover-github-workflow-runs"
import { createGitHubActionsClient } from "../integrations/github/create-github-actions-client"
import { discoverGitHubWorkflowRunsJob } from "./discover-github-workflow-runs"
import { recoverGitHubWebhookDeliveriesJob } from "./recover-github-webhook-deliveries"

vi.mock("../integrations/prisma", () => ({ prisma: {} }))
vi.mock("../domains/github-builds/discover-github-workflow-runs", () => ({
  discoverGitHubWorkflowRuns: vi.fn(),
}))
vi.mock("../domains/github-builds/enqueue-github-workflow-run-retries", () => ({
  enqueueGitHubWorkflowRunRetries: vi.fn(),
}))
vi.mock("../domains/github-webhooks/recover-github-webhook-deliveries", () => ({
  recoverGitHubWebhookDeliveries: vi.fn(),
}))
vi.mock("../integrations/github/create-github-actions-client", () => ({
  createGitHubActionsClient: vi.fn(),
}))

const githubKeys = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_WEBHOOK_SECRET",
] as const

function clearGitHubSettings() {
  for (const key of githubKeys) vi.stubEnv(key, "")
  vi.stubEnv("REPLICA_COPILOT_AUTHENTICATION", "")
}

describe("GitHub recovery workers", () => {
  it("skips an unconfigured App and fails for incomplete installation settings", async () => {
    clearGitHubSettings()
    await expect(discoverGitHubWorkflowRunsJob()).resolves.toBeUndefined()
    await expect(recoverGitHubWebhookDeliveriesJob()).resolves.toBeUndefined()

    vi.stubEnv("GITHUB_APP_ID", "123")
    await expect(discoverGitHubWorkflowRunsJob()).rejects.toThrow("incomplete or invalid")
    await expect(recoverGitHubWebhookDeliveriesJob()).rejects.toThrow("incomplete or invalid")
  })

  it("reuses one Actions client for all discovery requests to each repository", async () => {
    clearGitHubSettings()
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    vi.stubEnv("GITHUB_APP_ID", "123")
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456")
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY_BASE64",
      Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"),
    )
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "test-secret-at-least-20-characters")
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/test")
    vi.mocked(createGitHubActionsClient).mockImplementation(() => ({
      listBranchHeads: vi.fn(() => Promise.resolve([])),
      isAncestor: vi.fn(() => Promise.resolve(false)),
      getWorkflowRun: vi.fn(() => Promise.resolve(null)),
      getCommitAuthor: vi.fn(() => Promise.resolve(null)),
      listWorkflowRuns: vi.fn(() => Promise.resolve([])),
      listRunArtifacts: vi.fn(() => Promise.resolve([])),
      downloadArtifact: vi.fn(() => Promise.resolve({ status: "gone" as const })),
    }))
    vi.mocked(discoverGitHubWorkflowRuns).mockImplementation(async (dependencies) => {
      await dependencies.listBranchHeads(1)
      await dependencies.isAncestor(1, "a", "b")
      await dependencies.listWorkflowRuns(1, new Date())
      await dependencies.listBranchHeads(2)
      return []
    })

    await discoverGitHubWorkflowRunsJob()

    expect(createGitHubActionsClient).toHaveBeenCalledTimes(2)
    expect(createGitHubActionsClient).toHaveBeenCalledWith(
      expect.objectContaining({ githubRepositoryId: 1 }),
    )
    expect(createGitHubActionsClient).toHaveBeenCalledWith(
      expect.objectContaining({ githubRepositoryId: 2 }),
    )
  })
})
