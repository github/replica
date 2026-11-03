import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, it, vi } from "vitest"

import { BrowserBar } from "."
import browserStyles from "./styles.css?inline"

const address = "http://localhost:5173/#/cli/cli/tree/main"

function renderBar(onNavigate = vi.fn(), appearance: "light" | "dark" = "light") {
  render(
    <BrowserBar
      address={address}
      canGoBack
      canGoForward={false}
      appearance={appearance}
      onAppearanceChange={vi.fn()}
      onBack={vi.fn()}
      onForward={vi.fn()}
      onNavigate={onNavigate}
      onOpenTab={async () => {}}
      onReload={vi.fn()}
    />,
  )
  return onNavigate
}

it.each(["light", "dark"] as const)(
  "uses the system's %s fallback independently of the selected prototype appearance",
  (mode) => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)" && mode === "dark",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    renderBar(vi.fn(), mode === "light" ? "dark" : "light")
    const theme = screen
      .getByRole("navigation", { name: "Prototype navigation" })
      .closest("[data-color-mode]")
    expect(theme).toHaveAttribute("data-color-mode", mode)
    expect(browserStyles).toContain(
      "--hub-canvas-default: var(--background-color-default, var(--brand-color-canvas-default));",
    )
    expect(browserStyles).toContain(
      "--hub-fg-default: var(--text-color-default, var(--brand-color-text-default));",
    )
    expect(browserStyles).toContain('html[data-color-mode="dark"] .canvas-browser-bar')
    expect(browserStyles).toContain('body[data-color-mode="light"] .canvas-browser-bar')
  },
)

it("keeps navigation on the prototype origin and reports invalid addresses", () => {
  const navigate = renderBar()
  const input = screen.getByRole("textbox", { name: "Prototype address" })
  fireEvent.change(input, { target: { value: "/settings?tab=account#profile" } })
  fireEvent.submit(input.closest("form")!)
  expect(navigate).toHaveBeenCalledWith("http://localhost:5173/settings?tab=account#profile")

  fireEvent.change(input, { target: { value: "https://elsewhere.example/" } })
  fireEvent.submit(input.closest("form")!)
  expect(screen.getByRole("alert")).toHaveTextContent("prototype's origin")
  expect(navigate).toHaveBeenCalledTimes(1)

  fireEvent.change(input, { target: { value: "http://[invalid" } })
  fireEvent.submit(input.closest("form")!)
  expect(screen.getByRole("alert")).toHaveTextContent("valid URL")
})

it("exposes browser actions and resets an edited address with Escape", () => {
  renderBar()
  expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Light appearance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  expect(screen.getByRole("button", { name: "Open preview in browser" })).toBeEnabled()
  const input = screen.getByRole("textbox", { name: "Prototype address" })
  fireEvent.change(input, { target: { value: "/unfinished" } })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(input).toHaveValue(address)
})

it("opens the current preview through the extension and shows failures", async () => {
  const open = vi.fn().mockRejectedValue(new Error("Could not open the browser."))
  render(
    <BrowserBar
      address={address}
      canGoBack={false}
      canGoForward={false}
      appearance="dark"
      onAppearanceChange={vi.fn()}
      onBack={vi.fn()}
      onForward={vi.fn()}
      onNavigate={vi.fn()}
      onOpenTab={open}
      onReload={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Open preview in browser" }))
  expect(open).toHaveBeenCalledOnce()
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Could not open the browser."),
  )
})
