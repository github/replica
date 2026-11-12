import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubEmptyState } from "."

describe("HubEmptyState()", () => {
  it("keeps illustration decorative and presents optional heading with description", () => {
    render(
      <HubEmptyState
        visual={<svg data-testid="visual" />}
        heading="No builds yet"
        description="Publish a Build to see it here."
      />,
    )

    expect(screen.getByRole("heading", { level: 2, name: "No builds yet" })).toBeInTheDocument()
    expect(screen.getByText("Publish a Build to see it here.")).toBeInTheDocument()
    expect(screen.getByTestId("visual").parentElement).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByRole("status")).toHaveTextContent("No builds yet")
  })

  it("renders the optional secondary action and calls its handler", () => {
    const onAction = vi.fn()
    render(
      <HubEmptyState
        heading="No Builds yet"
        description="Refresh to check again."
        actionLabel="Refresh Builds"
        onAction={onAction}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Refresh Builds" }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it("renders a primary navigation action without a click handler", () => {
    render(
      <HubEmptyState
        heading="No prototypes yet"
        description="Build your first prototype."
        actionLabel="Build prototype"
        actionHref="/repositories/2001/new"
      />,
    )

    const action = screen.getByRole("link", { name: "Build prototype" })
    expect(action).toHaveAttribute("href", "/repositories/2001/new")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
