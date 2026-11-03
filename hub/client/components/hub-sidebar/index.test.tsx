import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import { describe, expect, it, vi } from "vitest"

import { HubSidebar } from "."

describe("HubSidebar()", () => {
  it("provides a named frame, header accessory and referenced ghost close button", () => {
    const onClose = vi.fn()
    const closeRef = createRef<HTMLButtonElement>()
    render(
      <HubSidebar
        title="Comments"
        open
        closeLabel="Close comments"
        closeShortcut="Shift+C"
        closeRef={closeRef}
        onClose={onClose}
        headerAccessory={<span>3</span>}
      >
        <p>Custom content</p>
      </HubSidebar>,
    )
    expect(screen.getByRole("complementary", { name: "Comments" })).toHaveClass("hub-sidebar")
    expect(screen.getByRole("heading", { name: "Comments" })).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("Custom content")).toBeInTheDocument()
    const close = screen.getByRole("button", { name: "Close comments" })
    expect(close).toHaveClass("hub-icon-button--invisible")
    expect(close).toHaveAttribute("aria-keyshortcuts", "Shift+C")
    expect(closeRef.current).toBe(close)
    act(() => closeRef.current?.focus())
    expect(close).toHaveFocus()
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps custom content mounted while closing and reopening", () => {
    const props = { title: "Hub", closeLabel: "Close Hub", onClose: vi.fn() }
    const view = render(
      <HubSidebar {...props} open>
        <input aria-label="Draft" defaultValue="" />
      </HubSidebar>,
    )
    const draft = screen.getByRole("textbox", { name: "Draft" })
    fireEvent.change(draft, { target: { value: "Keep this" } })
    view.rerender(
      <HubSidebar {...props} open={false}>
        <input aria-label="Draft" defaultValue="" />
      </HubSidebar>,
    )
    const sidebar = view.container.querySelector("aside")
    expect(sidebar).toHaveAttribute("aria-hidden", "true")
    expect(sidebar).toHaveAttribute("inert")
    expect(sidebar).toHaveAttribute("data-open", "false")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    view.rerender(
      <HubSidebar {...props} open>
        <input aria-label="Draft" defaultValue="" />
      </HubSidebar>,
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Keep this")
    expect(sidebar).not.toHaveAttribute("inert")
  })

  it("keeps a blocked close action disabled and described", () => {
    const onClose = vi.fn()
    render(
      <HubSidebar title="Hub" open closeLabel="Close Hub" closeDisabled onClose={onClose}>
        Content
      </HubSidebar>,
    )
    const close = screen.getByRole("button", { name: "Close Hub" })
    expect(close).toBeDisabled()
    expect(close).toHaveAccessibleDescription("Close Hub")
    fireEvent.click(close)
    expect(onClose).not.toHaveBeenCalled()
  })
})
