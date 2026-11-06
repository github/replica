import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { FormBoundary } from "."

describe("FormBoundary()", () => {
  it("announces routine feedback outside the form without taking focus and permits dismissal", () => {
    const onSubmit = vi.fn()
    const { container, rerender } = render(
      <FormBoundary busy={false} onSubmit={onSubmit}>
        <input aria-label="Prototype name" />
      </FormBoundary>,
      { wrapper: HubThemeProvider },
    )
    const field = screen.getByRole("textbox", { name: "Prototype name" })
    field.focus()

    rerender(
      <FormBoundary busy={false} notice="Prototype details saved." onSubmit={onSubmit}>
        <input aria-label="Prototype name" />
      </FormBoundary>,
    )

    const notifications = screen.getByRole("region", { name: "Notifications" })
    expect(within(notifications).getByRole("status")).toHaveTextContent("Prototype details saved.")
    expect(container).not.toContainElement(notifications)
    expect(field).toHaveFocus()

    fireEvent.click(within(notifications).getByRole("button", { name: /dismiss/i }))
    expect(screen.queryByText("Prototype details saved.")).not.toBeInTheDocument()
  })

  it("keeps a failed save inline and focuses its actionable error feedback", () => {
    const onSubmit = vi.fn()
    const { container, rerender } = render(
      <FormBoundary busy={false} onSubmit={onSubmit}>
        <input aria-label="Prototype name" />
      </FormBoundary>,
      { wrapper: HubThemeProvider },
    )
    screen.getByRole("textbox", { name: "Prototype name" }).focus()

    rerender(
      <FormBoundary busy={false} error="Your changes could not be saved." onSubmit={onSubmit}>
        <input aria-label="Prototype name" />
      </FormBoundary>,
    )

    const error = screen.getByRole("alert")
    expect(error).toHaveTextContent("Your changes could not be saved.")
    expect(container).toContainElement(error)
    expect(document.activeElement).toHaveTextContent("Your changes could not be saved.")
    expect(screen.queryByRole("region", { name: "Notifications" })).not.toBeInTheDocument()
  })
})
