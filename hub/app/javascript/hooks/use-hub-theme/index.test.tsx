import { act } from "react"
import { createPortal } from "react-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider, useHubTheme } from "."

function ThemeProbe() {
  const { resolvedColorMode, setColorMode } = useHubTheme()

  return (
    <>
      <span>{resolvedColorMode}</span>
      <button onClick={() => setColorMode("dark")}>Use dark</button>
      <button onClick={() => setColorMode("auto")}>Use system</button>
      {createPortal(<button>Portaled control</button>, document.body)}
    </>
  )
}

describe("useHubTheme()", () => {
  it("follows the system until a reviewer selects a color mode", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const preference = Object.assign(window.matchMedia("(prefers-color-scheme: dark)"), {
      matches: true,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") {
          listeners.add(listener)
        }
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener === "function") {
          listeners.delete(listener)
        }
      },
    })
    vi.spyOn(window, "matchMedia").mockReturnValue(preference)

    render(
      <HubThemeProvider>
        <ThemeProbe />
      </HubThemeProvider>,
    )
    expect(screen.getByText("dark")).toBeInTheDocument()
    expect(document.querySelector(".hub-theme")).toHaveAttribute("data-color-mode", "dark")
    const portal = screen.getByRole("button", { name: "Portaled control" })
    expect(portal.parentElement).toBe(document.body)
    expect(portal.closest("[data-color-mode]")).toBe(document.documentElement)
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")

    fireEvent.click(screen.getByRole("button", { name: "Use dark" }))
    portal.focus()
    act(() => {
      preference.matches = false
      for (const listener of listeners) listener({ matches: false } as MediaQueryListEvent)
    })
    expect(screen.getByText("dark")).toBeInTheDocument()
    expect(document.querySelector(".hub-theme")).toHaveAttribute("data-color-mode", "dark")
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")
    expect(portal).toHaveFocus()

    fireEvent.click(screen.getByRole("button", { name: "Use system" }))
    expect(screen.getByText("light")).toBeInTheDocument()
    expect(document.querySelector(".hub-theme")).toHaveAttribute("data-color-mode", "light")
    expect(document.documentElement).toHaveAttribute("data-color-mode", "light")
    act(() => {
      preference.matches = true
      for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent)
    })
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")
    expect(portal).toHaveFocus()
  })

  it("updates when the Storybook toolbar selects a color mode", () => {
    const { rerender } = render(
      <HubThemeProvider colorMode="light">
        <ThemeProbe />
      </HubThemeProvider>,
    )
    expect(screen.getByText("light")).toBeInTheDocument()
    expect(document.documentElement).toHaveAttribute("data-color-mode", "light")

    rerender(
      <HubThemeProvider colorMode="dark">
        <ThemeProbe />
      </HubThemeProvider>,
    )
    expect(screen.getByText("dark")).toBeInTheDocument()
    expect(document.querySelector(".hub-theme")).toHaveAttribute("data-color-mode", "dark")
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")
  })

  it.each([null, "light"])("restores the previous document theme %s on unmount", (previousMode) => {
    if (previousMode !== null)
      document.documentElement.setAttribute("data-color-mode", previousMode)
    const { unmount } = render(<HubThemeProvider colorMode="dark" />)
    expect(document.documentElement).toHaveAttribute("data-color-mode", "dark")

    unmount()
    expect(document.documentElement.getAttribute("data-color-mode")).toBe(previousMode)
    document.documentElement.removeAttribute("data-color-mode")
  })
})
