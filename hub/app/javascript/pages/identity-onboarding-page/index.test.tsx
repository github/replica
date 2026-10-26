import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { IdentityOnboardingPage } from "."
import type { IdentityConfiguration, IdentityOnboardingPageProps, IdentitySession } from "./types"

const configuration: IdentityConfiguration = {
  demoMode: true,
  credentialProvider: "environment",
  signInProviders: [
    { name: "github", configured: true },
    { name: "oidc-demo", configured: true },
  ],
  repositoryProvider: "github",
}

function props(overrides: Partial<IdentityOnboardingPageProps> = {}): IdentityOnboardingPageProps {
  return {
    configuration,
    session: null,
    selectedProvider: null,
    busy: false,
    error: null,
    showSetup: false,
    onSelectProvider: vi.fn(),
    onContinueFromSetup: vi.fn(),
    onBack: vi.fn(),
    onStartGitHub: vi.fn(),
    onSubmitGitHubDemo: vi.fn(),
    onSubmitOidc: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  }
}

describe("IdentityOnboardingPage()", () => {
  it("requires the clone-time setup walkthrough before showing sign-in providers", () => {
    const onContinueFromSetup = vi.fn()
    const pageProps = props({
      showSetup: true,
      onContinueFromSetup,
    })
    const { rerender } = render(<IdentityOnboardingPage {...pageProps} />)

    expect(
      screen.getByRole("heading", { name: "Configure Replica after cloning" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/git clone https:\/\/github\.com\/github\/replica\.git/),
    ).toBeInTheDocument()
    expect(screen.getByText(/npm ci/)).toBeInTheDocument()
    expect(screen.getByText(/HUB_SIGN_IN_PROVIDERS=github,oidc-demo/)).toBeInTheDocument()
    expect(screen.getByText(/HUB_REPOSITORY_PROVIDER=github/)).toBeInTheDocument()
    expect(screen.getByText(/HUB_CREDENTIAL_PROVIDER=environment/)).toBeInTheDocument()
    expect(
      screen.getByText(/credentials stay in the selected credential provider/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/npm run dev:api/)).toBeInTheDocument()
    expect(screen.getByText(/npm run dev/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Sign in with GitHub/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Continue to user sign-in" }))

    expect(onContinueFromSetup).toHaveBeenCalledOnce()

    rerender(<IdentityOnboardingPage {...pageProps} showSetup={false} />)

    expect(screen.getByRole("button", { name: /Sign in with GitHub/ })).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Configure Replica after cloning" }),
    ).not.toBeInTheDocument()
  })

  it("keeps provider choice explicit and reviews only the selected adapter", () => {
    const pageProps = props()
    const { rerender } = render(<IdentityOnboardingPage {...pageProps} />)

    fireEvent.click(screen.getByRole("button", { name: /Sign in with OIDC/ }))

    expect(pageProps.onSelectProvider).toHaveBeenCalledExactlyOnceWith("oidc-demo")
    expect(pageProps.onStartGitHub).not.toHaveBeenCalled()

    rerender(<IdentityOnboardingPage {...pageProps} selectedProvider="oidc-demo" />)

    expect(screen.getByRole("heading", { name: "Sign in with OIDC" })).toBeInTheDocument()
    expect(screen.getByText("oidc-demo")).toBeInTheDocument()
    expect(screen.getByText("Explicit local demo")).toBeInTheDocument()
    expect(screen.getByText(/Demo only/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Continue to GitHub" })).not.toBeInTheDocument()
  })

  it("submits the clearly labeled GitHub recording helper without starting real OAuth", () => {
    const onStartGitHub = vi.fn()
    const onSubmitGitHubDemo = vi.fn()
    render(
      <IdentityOnboardingPage
        {...props({
          selectedProvider: "github",
          onStartGitHub,
          onSubmitGitHubDemo,
        })}
      />,
    )

    expect(screen.getByText(/Recording helper/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: "GitHub user ID" }), {
      target: { value: "github-user-1001" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "GitHub login" }), {
      target: { value: "octodemo" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Octo Demo" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Simulate completed GitHub authorization" }))

    expect(onSubmitGitHubDemo).toHaveBeenCalledExactlyOnceWith({
      subject: "github-user-1001",
      login: "octodemo",
      name: "Octo Demo",
    })
    expect(onStartGitHub).not.toHaveBeenCalled()
  })

  it("submits a provider-neutral demo identity while repository integration is unavailable", () => {
    const onSubmitOidc = vi.fn()
    render(
      <IdentityOnboardingPage
        {...props({
          configuration: {
            demoMode: true,
            credentialProvider: "none",
            signInProviders: [{ name: "oidc-demo", configured: true }],
            repositoryProvider: "none",
          },
          selectedProvider: "oidc-demo",
          onSubmitOidc,
        })}
      />,
    )

    fireEvent.change(screen.getByRole("textbox", { name: "OIDC subject" }), {
      target: { value: "enterprise-user-1001" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Display login" }), {
      target: { value: "octodemo" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Octo Demo" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create simulated OIDC session" }))

    expect(onSubmitOidc).toHaveBeenCalledExactlyOnceWith({
      subject: "enterprise-user-1001",
      login: "octodemo",
      name: "Octo Demo",
    })
  })

  it("shows GitHub App repository access for a GitHub demo session", () => {
    const session: IdentitySession = {
      user: {
        id: "user-1",
        provider: "github",
        providerId: "github-user-1001",
        login: "octodemo",
        name: "Octo Demo",
        avatarUrl: null,
        administrator: false,
      },
      session: {
        id: "session-1",
        signedInAt: "2026-10-26T20:00:00.000Z",
      },
      csrfToken: "csrf-token",
    }

    render(<IdentityOnboardingPage {...props({ session })} />)

    expect(
      screen.getByRole("heading", { name: "GitHub repository integration" }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Connected through the GitHub App/)).toBeInTheDocument()
    expect(screen.getByText(/github\/replica/i)).toBeInTheDocument()
    expect(screen.getByText("read")).toBeInTheDocument()
    expect(screen.getByText(/configured App installation/i)).toBeInTheDocument()
  })

  it("completes OIDC onboarding without repository capabilities when no provider is configured", () => {
    const session: IdentitySession = {
      user: {
        id: "user-1",
        provider: "oidc-demo",
        providerId: "enterprise-user-1001",
        login: "octodemo",
        name: "Octo Demo",
        avatarUrl: null,
        administrator: false,
      },
      session: {
        id: "session-1",
        signedInAt: "2026-10-26T20:00:00.000Z",
      },
      csrfToken: "csrf-token",
    }

    render(
      <IdentityOnboardingPage
        {...props({
          configuration: {
            demoMode: true,
            credentialProvider: "none",
            signInProviders: [{ name: "oidc-demo", configured: true }],
            repositoryProvider: "none",
          },
          session,
        })}
      />,
    )

    expect(screen.getByRole("heading", { name: "Welcome, Octo Demo" })).toBeInTheDocument()
    expect(screen.getByText("octodemo")).toBeInTheDocument()
    expect(screen.getByText("OIDC demo")).toBeInTheDocument()
    expect(screen.getByText("session-1")).toBeInTheDocument()
    expect(screen.getByText(/No repository provider is configured/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /repository/i })).not.toBeInTheDocument()
  })

  it("requires a separate GitHub identity before an OIDC session can use GitHub repositories", () => {
    const session: IdentitySession = {
      user: {
        id: "user-1",
        provider: "oidc-demo",
        providerId: "enterprise-user-1001",
        login: "octodemo",
        name: "Octo Demo",
        avatarUrl: null,
        administrator: false,
      },
      session: {
        id: "session-1",
        signedInAt: "2026-10-26T20:00:00.000Z",
      },
      csrfToken: "csrf-token",
    }

    render(<IdentityOnboardingPage {...props({ session })} />)

    expect(screen.getByText(/no linked GitHub identity/i)).toBeInTheDocument()
    expect(screen.getByText(/Repository features stay unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText("read")).not.toBeInTheDocument()
  })
})
