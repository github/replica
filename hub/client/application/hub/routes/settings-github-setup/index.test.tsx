import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { GitHubSetupStatus } from "@application/hub/github-setup-contracts/types"
import { getGitHubSetupStatus } from "@application/hub/requests/get-github-setup-status"
import { testGitHubConnection } from "@application/hub/requests/test-github-connection"

import SettingsGithubSetup from "."

vi.mock("@application/hub/requests/get-github-setup-status", () => ({
  getGitHubSetupStatus: vi.fn(),
}))
vi.mock("@application/hub/requests/test-github-connection", () => ({
  testGitHubConnection: vi.fn(),
}))

const status: GitHubSetupStatus = {
  status: "configured",
  signInEnabled: true,
  settings: [{ key: "GITHUB_CLIENT_ID", state: "present" }],
  urls: {
    homepage: "https://hub.example.test",
    callback: "https://hub.example.test/api/auth/github/callback",
    setup: "https://hub.example.test/settings/github/setup?step=install",
    webhook: "https://hub.example.test/api/github/webhooks",
  },
  connectedRepositories: ["octo/old"],
}

afterEach(() => {
  vi.resetAllMocks()
})

describe("SettingsGithubSetup", () => {
  it("refreshes connected repositories after a successful connection test", async () => {
    vi.mocked(testGitHubConnection).mockResolvedValue({
      checks: [{ name: "private_key", result: "pass", detail: "The private key is valid." }],
    })
    vi.mocked(getGitHubSetupStatus).mockResolvedValue({
      ...status,
      connectedRepositories: ["octo/new"],
    })
    render(<SettingsGithubSetup loaderData={{ status }} />)

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))

    expect(await screen.findByText("The private key is valid.")).toBeVisible()
    expect(screen.getByRole("list", { name: "Connected repositories" })).toHaveTextContent(
      "octo/new",
    )
    expect(screen.getByRole("link", { name: "Sign in with GitHub" })).toHaveAttribute("href", "/")
  })

  it("keeps the connection results visible if refreshing the repository list fails", async () => {
    vi.mocked(testGitHubConnection).mockResolvedValue({
      checks: [{ name: "private_key", result: "pass", detail: "The private key is valid." }],
    })
    vi.mocked(getGitHubSetupStatus).mockRejectedValue(new Error("network unavailable"))
    render(<SettingsGithubSetup loaderData={{ status }} />)

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))

    expect(await screen.findByText("The private key is valid.")).toBeVisible()
    expect(screen.getByText("Could not refresh connected repositories")).toBeVisible()
    expect(screen.queryByText("The connection test did not run")).toBeNull()
    expect(screen.getByRole("list", { name: "Connected repositories" })).toHaveTextContent(
      "octo/old",
    )
  })
})
