import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SignInPage } from "."

describe("SignInPage()", () => {
  it("starts GitHub sign-in without presenting repository access as authentication", () => {
    const onSignIn = vi.fn()
    render(
      <SignInPage
        configured
        loading={false}
        user={null}
        error={null}
        onSignIn={onSignIn}
        onSignOut={() => undefined}
        onBootstrap={() => undefined}
        onRecovery={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }))

    expect(onSignIn).toHaveBeenCalledOnce()
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

  it("disables sign-in when GitHub user authorization is not configured", () => {
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

    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeDisabled()
    expect(screen.getByText(/has not been configured/)).toBeVisible()
  })
})
