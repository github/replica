import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { GithubAppSetupShowPage } from "."
import type { GithubAppSetupShowPageProps } from "./types"

const urls = {
  homepage: "https://hub.example.com",
  callback: "https://hub.example.com/api/auth/github/callback",
  setup: "https://hub.example.com/settings/github/setup?step=install",
  webhook: "https://hub.example.com/api/github/webhooks",
}

function props(overrides: Partial<GithubAppSetupShowPageProps> = {}): GithubAppSetupShowPageProps {
  return {
    status: {
      status: "configured",
      signInEnabled: true,
      settings: [{ key: "GITHUB_APP_ID", state: "present" }],
      urls,
      connectedRepositories: ["octo/checkout-flow", "octo/design-review"],
    },
    bootstrap: { error: null, pending: false, onSubmit: vi.fn() },
    organization: "",
    onOrganizationChange: vi.fn(),
    creationUrl: "https://github.com/settings/apps/new",
    connection: { checks: null, testing: false, error: null, onTest: vi.fn() },
    signInPath: "/sign-in",
    ...overrides,
  }
}

describe("GithubAppSetupShowPage()", () => {
  it("asks for the bootstrap secret before showing setup", () => {
    const onSubmit = vi.fn()
    render(
      <GithubAppSetupShowPage
        {...props({ status: null, bootstrap: { error: null, pending: false, onSubmit } })}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Bootstrap secret/), { target: { value: "s3cret" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue" }))

    expect(onSubmit).toHaveBeenCalledWith("s3cret")
    expect(screen.queryByText("1. Register the GitHub App")).toBeNull()
  })

  it("shows the callback URL for reusing an existing App", () => {
    render(<GithubAppSetupShowPage {...props()} />)

    expect(screen.getByRole("radio", { name: "Reuse an existing App" })).toBeChecked()
    expect(screen.getByDisplayValue(urls.callback)).toBeVisible()
    expect(screen.getByText(/webhooks to one URL/i)).toBeVisible()
  })

  it("explains that the prefilled form cannot supply the webhook secret", () => {
    render(<GithubAppSetupShowPage {...props()} />)

    fireEvent.click(screen.getByRole("radio", { name: "Create from a prefilled form" }))

    expect(screen.getByText(/webhook secret cannot be prefilled/i)).toBeVisible()
  })

  it("shows connected repositories and a verified installation link after testing", () => {
    const { rerender } = render(<GithubAppSetupShowPage {...props()} />)

    expect(screen.getByRole("list", { name: "Connected repositories" })).toHaveTextContent(
      "octo/checkout-flow",
    )
    expect(screen.queryByRole("link", { name: "Manage repositories on GitHub" })).toBeNull()

    rerender(
      <GithubAppSetupShowPage
        {...props({
          connection: {
            checks: [
              {
                name: "installation",
                result: "pass",
                detail: "Installed.",
                settingsUrl: "https://github.com/settings/installations/34",
              },
            ],
            testing: false,
            error: null,
            onTest: vi.fn(),
          },
        })}
      />,
    )

    expect(screen.getByRole("link", { name: "Manage repositories on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/settings/installations/34",
    )
  })

  it("switches the secret guide to local development", () => {
    render(<GithubAppSetupShowPage {...props()} />)

    fireEvent.click(screen.getByRole("radio", { name: "Local development (.env)" }))

    expect(screen.getByText(/npm run env:init/)).toBeVisible()
  })

  it("runs the connection test and reports each check", () => {
    const onTest = vi.fn()
    const { rerender } = render(
      <GithubAppSetupShowPage
        {...props({ connection: { checks: null, testing: false, error: null, onTest } })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    expect(onTest).toHaveBeenCalled()

    rerender(
      <GithubAppSetupShowPage
        {...props({
          connection: {
            checks: [{ name: "app_identity", result: "fail", detail: "GitHub rejected the key." }],
            testing: false,
            error: null,
            onTest,
          },
        })}
      />,
    )
    expect(screen.getByText("GitHub rejected the key.")).toBeVisible()
    expect(screen.getByLabelText("Failed")).toBeInTheDocument()
  })

  it("hides the connection test until every setting is present", () => {
    render(
      <GithubAppSetupShowPage
        {...props({
          status: {
            status: "incomplete",
            signInEnabled: false,
            settings: [{ key: "GITHUB_APP_ID", state: "missing" }],
            urls,
            connectedRepositories: [],
          },
        })}
      />,
    )

    expect(screen.queryByRole("button", { name: "Test connection" })).toBeNull()
    expect(screen.getByText("Missing")).toBeVisible()
  })
})
