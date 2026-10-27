import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SignInPage } from "."

describe("SignInPage()", () => {
  it("starts sign-in with the configured provider label without presenting repository access as authentication", () => {
    const onSignIn = vi.fn()
    render(
      <SignInPage
        configured
        providerLabel="Company SSO"
        loading={false}
        user={null}
        error={null}
        onSignIn={onSignIn}
        onSignOut={() => undefined}
        onBootstrap={() => undefined}
        onRecovery={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Company SSO" }))

    expect(onSignIn).toHaveBeenCalledOnce()
    expect(screen.getByText(/Sign in with Company SSO to create a Hub session/)).toBeVisible()
    expect(screen.getByText(/Repository access is authorized separately/)).toBeVisible()
  })

  it("shows the provider-neutral session identity and sign-out control", () => {
    render(
      <SignInPage
        configured
        loading={false}
        user={{ displayName: "Mona Lisa", username: "mona", avatarUrl: null }}
        error={null}
        onSignIn={() => undefined}
        onSignOut={() => undefined}
        onBootstrap={() => undefined}
        onRecovery={() => undefined}
      />,
    )

    expect(screen.getByText(/Signed in as/)).toHaveTextContent("Mona Lisa (@mona)")
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled()
  })

  it("disables provider-neutral sign-in when authentication is not configured", () => {
    render(
      <SignInPage
        configured={false}
        loading={false}
        user={null}
        error={null}
        onSignIn={() => undefined}
        onSignOut={() => undefined}
        onBootstrap={() => undefined}
        onRecovery={() => undefined}
      />,
    )

    expect(screen.getByRole("button", { name: "Sign in with identity provider" })).toBeDisabled()
    expect(screen.getByText(/has not been configured/)).toBeVisible()
  })
})
