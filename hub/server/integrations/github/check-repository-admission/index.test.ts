import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkRepositoryAdmission } from "#server/integrations/github/check-repository-admission"
import { createInstallationToken } from "#server/integrations/github/create-installation-token"
import { requestGitHubApi } from "#server/integrations/github/request-github-api"

vi.mock("#server/integrations/github/create-installation-token", () => ({
  createInstallationToken: vi.fn(),
}))
vi.mock("#server/integrations/github/request-github-api", () => ({
  requestGitHubApi: vi.fn(),
}))

const credentials = {
  appId: "1",
  installationId: "2",
  clientId: "client",
  clientSecret: "secret",
  privateKey: "key",
}
const profile = {
  subject: "42",
  username: "octocat",
  displayName: "The Octocat",
  avatarUrl: null,
}

describe("checkRepositoryAdmission()", () => {
  beforeEach(() => {
    vi.mocked(createInstallationToken).mockResolvedValue("installation-token")
  })

  it("does not treat public repository read access as collaboration", async () => {
    vi.mocked(requestGitHubApi).mockResolvedValue({
      repositories: [{ full_name: "github/public", private: false }],
    })

    await expect(checkRepositoryAdmission(credentials, profile)).resolves.toBe(false)
    expect(requestGitHubApi).toHaveBeenCalledOnce()
  })

  it("admits an explicit collaborator on a private installed repository", async () => {
    vi.mocked(requestGitHubApi)
      .mockResolvedValueOnce({
        repositories: [{ full_name: "github/private", private: true }],
      })
      .mockResolvedValueOnce({
        user: { id: 42 },
        permission: "read",
      })

    await expect(checkRepositoryAdmission(credentials, profile)).resolves.toBe(true)
  })

  it("fails closed after the bounded repository set is exhausted", async () => {
    vi.mocked(requestGitHubApi)
      .mockResolvedValueOnce({
        repositories: Array.from({ length: 100 }, (_, index) => ({
          full_name: `github/private-${index}`,
          private: true,
        })),
      })
      .mockResolvedValue({ user: { id: 42 }, permission: "none" })

    await expect(checkRepositoryAdmission(credentials, profile)).rejects.toMatchObject({
      code: "repository_limit",
      status: 503,
    })
    expect(requestGitHubApi).toHaveBeenCalledTimes(101)
  })
})
