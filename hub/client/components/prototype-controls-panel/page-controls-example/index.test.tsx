import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { PageControlsExample } from "."

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: {
      configurable: true,
      value(this: HTMLElement) {
        if (!this.hasAttribute("popover")) throw new Error("Popover is not initialized.")
      },
    },
    hidePopover: { configurable: true, value() {} },
  })
})

describe("PageControlsExample()", () => {
  it("shows shared and active page sets with page width priority and retained independent values", async () => {
    render(
      <ThemeProvider colorMode="auto">
        <PageControlsExample />
      </ThemeProvider>,
    )
    const panel = screen.getByRole("complementary", { name: "Controls" })
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    expect(within(panel).queryByRole("heading")).not.toBeInTheDocument()
    expect(within(panel).queryByText("Shared")).not.toBeInTheDocument()
    expect(within(panel).queryByText("Dashboard")).not.toBeInTheDocument()
    const shared = within(panel).getByRole("region", { name: "Shared" })
    const dashboard = within(panel).getByRole("region", { name: "Dashboard" })
    const divider = within(dashboard).getByRole("separator")
    expect(shared.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(within(shared).getByRole("textbox", { name: "Navigation label" })).toHaveValue(
      "Primary navigation",
    )
    const content = within(dashboard).getByRole("group", { name: "Content" })
    const appearance = within(dashboard).getByRole("group", { name: "Appearance" })
    expect(content.matches(".controls-group:not(:has(+ .controls-group))")).toBe(false)
    expect(appearance.matches(".controls-group:not(:has(+ .controls-group))")).toBe(true)
    expect(within(content).getByRole("button", { name: "Collapse Content" })).toHaveClass(
      "controls-ghost-button",
    )
    expect(within(panel).getByRole("button", { name: "Collapse controls" })).toHaveClass(
      "controls-ghost-button",
    )
    expect(content.querySelector(".controls-group-body")?.childElementCount).toBe(2)
    expect(appearance.querySelector(".controls-group-body")?.childElementCount).toBe(2)
    expect(dashboard.querySelectorAll(":scope > .controls-field")).toHaveLength(3)
    const footer = within(dashboard).getByRole("textbox", { name: "Footer" })
    const changelog = within(dashboard).getByRole("checkbox", { name: "Show changelog" })
    expect(content.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    )
    expect(appearance.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    )
    expect(appearance.contains(footer)).toBe(false)
    expect(appearance.contains(changelog)).toBe(false)
    fireEvent.change(within(content).getByRole("spinbutton", { name: "Item count" }), {
      target: { value: "5" },
    })
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Dashboard preview" })).getByText("5"),
      ).toBeInTheDocument(),
    )
    fireEvent.click(within(panel).getByRole("button", { name: "Collapse Content" }))
    expect(within(content).getByLabelText("Item count")).not.toBeVisible()
    expect(footer).toBeVisible()
    expect(changelog).toBeVisible()
    fireEvent.click(within(panel).getByRole("button", { name: "Expand Content" }))
    expect(within(content).getByRole("spinbutton", { name: "Item count" })).toHaveValue(5)
    expect(within(panel).getByRole("checkbox", { name: "Show navigation" })).toBeChecked()
    expect(within(panel).getByRole("textbox", { name: "Dashboard title" })).toHaveValue(
      "My dashboard",
    )
    expect(panel.style.width).toContain("320px")
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Show navigation" }))
    fireEvent.change(within(panel).getByRole("textbox", { name: "Dashboard title" }), {
      target: { value: "Saved dashboard" },
    })
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Dashboard preview" })).getByText(
          '"Saved dashboard"',
        ),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole("button", { name: "Details page" }))
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Details title" })).toHaveValue(
        "Item details",
      ),
    )
    expect(
      within(panel).queryByRole("textbox", { name: "Dashboard title" }),
    ).not.toBeInTheDocument()
    expect(within(panel).getByRole("checkbox", { name: "Show navigation" })).not.toBeChecked()
    expect(panel.style.width).toContain("440px")
    fireEvent.change(within(panel).getByRole("textbox", { name: "Details title" }), {
      target: { value: "Saved details" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Dashboard page" }))
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Dashboard title" })).toHaveValue(
        "Saved dashboard",
      ),
    )
    expect(panel.style.width).toContain("320px")
    fireEvent.click(screen.getByRole("button", { name: "Details page" }))
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Details title" })).toHaveValue(
        "Saved details",
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    fireEvent.click(screen.getByRole("button", { name: "Dashboard page" }))
    await waitFor(() =>
      expect(within(panel).getByRole("textbox", { name: "Dashboard title" })).toHaveValue(
        "My dashboard",
      ),
    )
    expect(within(panel).getByRole("checkbox", { name: "Show navigation" })).toBeChecked()
  })
})
