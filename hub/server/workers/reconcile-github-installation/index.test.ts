import { generateKeyPairSync } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { syncGitHubInstallationRepositories } from "../../domains/admission/sync-github-installation-repositories"
import { listInstallationRepositories } from "../../integrations/github/list-installation-repositories"
import { prisma } from "../../integrations/prisma"
import { reconcileGitHubInstallation } from "."

vi.mock("../../domains/admission/sync-github-installation-repositories", () => ({
  syncGitHubInstallationRepositories: vi.fn(),
}))
vi.mock("../../integrations/github/list-installation-repositories", () => ({
  listInstallationRepositories: vi.fn(),
}))
vi.mock("../../integrations/prisma", () => ({ prisma: {} }))

const privateKey = Buffer.from(
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "pem",
    type: "pkcs1",
  }),
).toString("base64")

function configureApp() {
  vi.stubEnv("GITHUB_APP_ID", "123")
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "456")
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY_BASE64", privateKey)
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-at-least-twenty-characters")
}

function configureSignIn() {
  vi.stubEnv("GITHUB_CLIENT_ID", "github-client")
  vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret")
  vi.stubEnv("GITHUB_PROVIDER_REVISION", "1")
  vi.stubEnv("HUB_APPLICATION_ORIGIN", "https://hub.example.test")
  vi.stubEnv("HUB_AUTHENTICATION_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"))
  vi.stubEnv("HUB_BOOTSTRAP_SECRET", "bootstrap-secret-that-is-at-least-32-characters")
}

describe("reconcileGitHubInstallation()", () => {
  beforeEach(() => {
    for (const key of [
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY_BASE64",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "GITHUB_PROVIDER_REVISION",
    ]) {
      vi.stubEnv(key, "")
    }
    vi.clearAllMocks()
  })

  it("does no work when an App is not configured", async () => {
    await expect(reconcileGitHubInstallation()).resolves.toBeUndefined()
    expect(syncGitHubInstallationRepositories).not.toHaveBeenCalled()
  })

  it("fails explicitly for incomplete App or sign-in settings", async () => {
    vi.stubEnv("GITHUB_APP_ID", "123")
    await expect(reconcileGitHubInstallation()).rejects.toThrow("incomplete or invalid")
    configureApp()
    await expect(reconcileGitHubInstallation()).rejects.toThrow("sign-in is not configured")
    expect(syncGitHubInstallationRepositories).not.toHaveBeenCalled()
  })

  it("uses the current provider revision and propagates sync failures", async () => {
    configureApp()
    configureSignIn()
    vi.mocked(syncGitHubInstallationRepositories).mockResolvedValueOnce([])

    await reconcileGitHubInstallation()

    expect(syncGitHubInstallationRepositories).toHaveBeenCalledOnce()
    const [database, fetchRepositories, provider] = vi.mocked(syncGitHubInstallationRepositories)
      .mock.calls[0]!
    expect(database).toBe(prisma)
    expect(provider.revision).toBe(1)
    expect(provider.configurationDigest).toMatch(/^[0-9a-f]{64}$/)
    await fetchRepositories()
    expect(listInstallationRepositories).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "123", installationId: "456" }),
    )

    const failure = new Error("installation sync failed")
    vi.mocked(syncGitHubInstallationRepositories).mockRejectedValueOnce(failure)
    await expect(reconcileGitHubInstallation()).rejects.toBe(failure)
  })
})
