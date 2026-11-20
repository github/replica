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
      getBuildWorkflowPaths: vi.fn(() => Promise.resolve([".github/workflows/replica.yml"])),
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

  it("uses configured workflow discovery and refreshes the selection for the next recovery poll", async () => {
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
    const actual = await vi.importActual<{
      createGitHubActionsClient: typeof createGitHubActionsClient
    }>("../integrations/github/create-github-actions-client")
    let filename = "publish-proto.yml"
    const request = vi.fn<typeof globalThis.fetch>((input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      if (url.pathname.endsWith("/access_tokens")) {
        return Promise.resolve(Response.json({ token: "test-token" }))
      }
      if (url.pathname === "/repositories/56") {
        return Promise.resolve(Response.json({ id: 56, default_branch: "trunk" }))
      }
      if (url.pathname === "/repositories/56/git/ref/heads/trunk") {
        return Promise.resolve(Response.json({ object: { type: "commit", sha: "c".repeat(40) } }))
      }
      if (url.pathname === `/repositories/56/git/trees/${"c".repeat(40)}`) {
        return Promise.resolve(
          Response.json({
            truncated: false,
            tree: [{ path: ".github", mode: "040000", type: "tree", sha: "d".repeat(40) }],
          }),
        )
      }
      if (url.pathname === `/repositories/56/git/trees/${"d".repeat(40)}`) {
        return Promise.resolve(
          Response.json({
            truncated: false,
            tree: [{ path: "replica.json", mode: "100644", type: "blob", sha: "e".repeat(40) }],
          }),
        )
      }
      if (url.pathname.endsWith("/replica.json")) {
        const content = JSON.stringify({
          version: 1,
          builds: { workflows: [`.github/workflows/${filename}`] },
        })
        return Promise.resolve(
          Response.json({
            type: "file",
            encoding: "base64",
            size: Buffer.byteLength(content),
            content: Buffer.from(content).toString("base64"),
          }),
        )
      }
      expect(url.pathname).toBe(`/repositories/56/actions/workflows/${filename}/runs`)
      return Promise.resolve(Response.json({ workflow_runs: [] }))
    })
    vi.mocked(createGitHubActionsClient).mockImplementation((input) =>
      actual.createGitHubActionsClient(input, { fetch: request }),
    )
    vi.mocked(discoverGitHubWorkflowRuns).mockImplementation(async (dependencies) => {
      await dependencies.listWorkflowRuns(56, new Date("2026-01-01T00:00:00Z"))
      return []
    })

    await discoverGitHubWorkflowRunsJob()
    filename = "preview.yaml"
    await discoverGitHubWorkflowRunsJob()

    expect(createGitHubActionsClient).toHaveBeenCalledTimes(2)
    const requests = request.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : input.toString()),
    )
    expect(
      requests
        .filter((url) => url.pathname.includes("/actions/workflows/"))
        .map((url) => url.pathname),
    ).toEqual([
      "/repositories/56/actions/workflows/publish-proto.yml/runs",
      "/repositories/56/actions/workflows/preview.yaml/runs",
    ])
  })
})
