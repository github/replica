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

it("keeps native controls on the system theme independently of the prototype appearance", () => {
  render(<style>{browserStyles}</style>)
  renderBar(vi.fn(), "dark")
  const theme = screen
    .getByRole("navigation", { name: "Prototype navigation" })
    .closest("[data-color-mode]")
  expect(theme).toHaveAttribute("data-color-mode", "auto")
  expect(theme).toHaveStyle("color-scheme: light dark")
  expect(screen.getByRole("button", { name: "Dark appearance" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
})

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
