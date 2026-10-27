import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test } from "vitest"

import App from "./app"

function renderApp(path = "/") {
  window.location.hash = `#${path}`
  return render(<App />)
}

test("navigates between the records and settings routes", async () => {
  const user = userEvent.setup()
  renderApp()
  expect(screen.getAllByRole("main")).toHaveLength(1)

  await user.click(screen.getByRole("link", { name: "Records" }))
  expect(window.location.hash).toBe("#/records")
  expect(await screen.findByRole("searchbox", { name: "Search records" })).toBeInTheDocument()

  await user.click(screen.getByRole("link", { name: "Settings" }))
  expect(window.location.hash).toBe("#/settings")
  expect(await screen.findByRole("textbox", { name: "Display name" })).toBeInTheDocument()
})

test("filters records and opens a meaningful record detail dialog", async () => {
  const user = userEvent.setup()
  renderApp("/records")

  const search = screen.getByRole("searchbox", { name: "Search records" })
  await user.type(search, "Sam Rivera")
  expect(screen.getByRole("button", { name: "Customer research" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Quarterly roadmap" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Website redesign" })).not.toBeInTheDocument()

  await user.click(screen.getByRole("button", { name: "Customer research" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByRole("heading", { name: "Customer research" })).toBeInTheDocument()
  expect(within(dialog).getByText("Sam Rivera")).toBeInTheDocument()
})

test("saves settings feedback and persists the trimmed display name", async () => {
  const user = userEvent.setup()
  const rendered = renderApp("/settings")

  const displayName = screen.getByRole("textbox", { name: "Display name" })
  await user.clear(displayName)
  await user.type(displayName, "  Taylor Example  ")
  await user.click(screen.getByRole("button", { name: "Save changes" }))

  expect(await screen.findByRole("status")).toHaveTextContent(/saved/i)
  rendered.unmount()
  renderApp("/settings")
  expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue("Taylor Example")
})
