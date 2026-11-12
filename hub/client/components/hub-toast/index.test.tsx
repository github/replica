import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubToast } from "."

describe("HubToast()", () => {
  it("stacks independent notifications in one portal without stealing focus", () => {
    const { container, rerender } = render(<input aria-label="Prototype name" />)
    const field = screen.getByRole("textbox", { name: "Prototype name" })
    field.focus()

    rerender(
      <>
        <input aria-label="Prototype name" />
        <HubToast title="Prototype details saved." />
        <HubToast title="Your export is ready." variant="info" />
      </>,
    )

    const notifications = screen.getByRole("region", { name: "Notifications" })
    expect(container).not.toContainElement(notifications)
    expect(within(notifications).getAllByRole("status")).toHaveLength(2)
    expect(field).toHaveFocus()
    const saved = within(notifications)
      .getByText("Prototype details saved.")
      .closest<HTMLElement>('[role="status"]')
    if (!saved) throw new Error("A notification must announce its status.")

    fireEvent.click(within(saved).getByRole("button", { name: "Dismiss notification" }))

    expect(screen.queryByText("Prototype details saved.")).not.toBeInTheDocument()
    expect(within(notifications).getByRole("status")).toHaveTextContent("Your export is ready.")
  })

  it("keeps the same ongoing message dismissed and displays a changed message", () => {
    const { rerender } = render(<HubToast title="Prototype details saved." />)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }))

    rerender(<HubToast title="Prototype details saved." />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()

    rerender(<HubToast title="Prototype description saved." />)
    expect(screen.getByRole("status")).toHaveTextContent("Prototype description saved.")
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeEnabled()
  })

  it("retains notifications after timers run and releases the portal with its last owner", () => {
    vi.useFakeTimers()
    const { rerender, unmount } = render(
      <>
        <HubToast title="First saved change." />
        <HubToast title="Second saved change." />
      </>,
    )
    const notifications = screen.getByRole("region", { name: "Notifications" })

    act(() => {
      vi.runAllTimers()
    })
    expect(within(notifications).getAllByRole("status")).toHaveLength(2)

    rerender(
      <>
        <HubToast title="First saved change." />
      </>,
    )
    expect(screen.getByRole("region", { name: "Notifications" })).toBe(notifications)
    expect(within(notifications).getByRole("status")).toHaveTextContent("First saved change.")

    unmount()
    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument()

    render(<HubToast title="First saved change." />)
    expect(screen.getByRole("status")).toHaveTextContent("First saved change.")
  })
})
