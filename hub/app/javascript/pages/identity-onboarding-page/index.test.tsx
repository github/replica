import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { IdentityOnboardingPage } from "."
import type { IdentityConfiguration, IdentityOnboardingPageProps, IdentitySession } from "./types"

const configuration: IdentityConfiguration = {
  demoMode: true,
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
    onSelectProvider: vi.fn(),
    onBack: vi.fn(),
    onStartGitHub: vi.fn(),
    onSubmitOidc: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  }
}

describe("IdentityOnboardingPage()", () => {
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

  it("submits a provider-neutral demo identity while repository integration is unavailable", () => {
    const onSubmitOidc = vi.fn()
    render(
      <IdentityOnboardingPage
        {...props({
          configuration: {
            demoMode: true,
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

  it("shows provider-neutral session details and repository capability gating", () => {
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
})
