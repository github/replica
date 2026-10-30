import type { PropsWithChildren } from "react"

import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { RepositoryUserMenu } from "."

const data = {
  accountMenuLabel: "Account menu for @octocat",
  authenticityToken: "test-token",
  currentUser: { avatarUrl: null, login: "octocat", name: "The Octocat" },
  darkThemeLabel: "Dark",
  lightThemeLabel: "Light",
  signOutLabel: "Sign out",
  signOutPath: "/sign_out",
  systemThemeLabel: "System",
}

function ThemeWrapper({ children }: PropsWithChildren) {
  return <HubThemeProvider colorMode="light">{children}</HubThemeProvider>
}

describe("RepositoryUserMenu()", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  it("shows the account identity and opens the sign-out menu when expanded", () => {
    render(<RepositoryUserMenu {...data} />, { wrapper: ThemeWrapper })

    expect(screen.getByText("The Octocat")).toBeVisible()
    const trigger = screen.getByRole("button", { name: data.accountMenuLabel })
    expect(trigger.className).toContain("Button--size-small")
    fireEvent.click(trigger)
    expect(screen.getByRole("menuitem", { name: data.signOutLabel })).toBeInTheDocument()
  })

  it("keeps the avatar-only trigger labelled when collapsed", () => {
    render(<RepositoryUserMenu {...data} collapsed />, { wrapper: ThemeWrapper })

    expect(screen.getByText("The Octocat")).not.toBeVisible()
    const trigger = screen.getByRole("button", { name: data.accountMenuLabel })
    expect(trigger.querySelector("img")).toHaveAttribute("src", "/avatar-placeholder.svg")
    fireEvent.click(trigger)
    expect(screen.getByRole("menuitem", { name: data.signOutLabel })).toBeInTheDocument()
  })

  it("uses a Brand avatar image when the user has one", () => {
    render(
      <RepositoryUserMenu
        {...data}
        currentUser={{ ...data.currentUser, avatarUrl: "/avatar.png" }}
      />,
      { wrapper: ThemeWrapper },
    )

    const avatar = screen.getByRole("button", { name: data.accountMenuLabel }).querySelector("img")
    expect(avatar).toHaveAttribute("src", "/avatar.png")
    expect(avatar?.closest(".hub-user-avatar--20")).toBeInTheDocument()
  })

  it.each(["Enter", " "])("submits sign-out once with %s", (key) => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {})
    render(<RepositoryUserMenu {...data} />, { wrapper: ThemeWrapper })

    fireEvent.click(screen.getByRole("button", { name: data.accountMenuLabel }))
    fireEvent.keyDown(screen.getByRole("menuitem", { name: data.signOutLabel }), { key })
    expect(requestSubmit).toHaveBeenCalledOnce()
  })

  it("selects system, light, and dark theme modes", () => {
    render(<RepositoryUserMenu {...data} />, { wrapper: ThemeWrapper })

    fireEvent.click(screen.getByRole("button", { name: data.accountMenuLabel }))
    expect(screen.getByRole("menu").firstElementChild).toHaveClass(
      "repository-user-menu__theme-control",
    )
    const lightMode = screen.getByRole("menuitemradio", { name: data.lightThemeLabel })
    const darkMode = screen.getByRole("menuitemradio", { name: data.darkThemeLabel })
    expect(lightMode.closest("[data-color-mode]")).toHaveAttribute("data-color-mode", "light")
    expect(lightMode).toHaveAttribute("aria-checked", "true")
    expect(lightMode).toHaveAttribute("data-selected", "true")
    lightMode.focus()
    expect(lightMode).toHaveFocus()
    darkMode.focus()
    expect(darkMode).toHaveFocus()
    fireEvent.click(darkMode)
    expect(document.querySelector(".hub-theme")).toHaveAttribute("data-color-mode", "dark")
    expect(darkMode.closest("[data-color-mode]")).toHaveAttribute("data-color-mode", "dark")
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")
    expect(darkMode).toHaveAttribute("aria-checked", "true")
    fireEvent.click(screen.getByRole("menuitemradio", { name: data.systemThemeLabel }))
    expect(screen.getByRole("menuitemradio", { name: data.systemThemeLabel })).toHaveAttribute(
      "aria-checked",
      "true",
    )
  })
})
