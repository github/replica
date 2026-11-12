import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import meta from "./stories"

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

describe("Movable controls example", () => {
  it("keeps two groups ordered with ungrouped fields below them and no technical scope heading", async () => {
    render(
      <ThemeProvider colorMode="auto">
        <meta.component />
      </ThemeProvider>,
    )
    const panel = screen.getByRole("complementary", { name: "Controls" })
    fireEvent.click(within(panel).getByRole("button", { name: "Reset all controls" }))
    expect(within(panel).queryByText("floatingPanelStory")).not.toBeInTheDocument()
    const details = within(panel).getByRole("group", { name: "Details" })
    const appearance = within(panel).getByRole("group", { name: "Appearance" })
    const footer = within(panel).getByRole("textbox", { name: "Footer" })
    expect(details.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    )
    expect(appearance.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    )
    expect(appearance.contains(footer)).toBe(false)
    fireEvent.change(within(appearance).getByRole("combobox", { name: "Layout" }), {
      target: { value: "grid" },
    })
    await waitFor(() => expect(screen.getByText("Layout: grid")).toBeInTheDocument())
    fireEvent.click(within(panel).getByRole("button", { name: "Collapse Appearance" }))
    expect(within(panel).getByLabelText("Layout")).not.toBeVisible()
    expect(footer).toBeVisible()
    expect(screen.getByText("Layout: grid")).toBeInTheDocument()
  })
})
