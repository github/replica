import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubAlert } from "."

describe("HubAlert()", () => {
  it("announces a failed Build and its explanation", () => {
    const { container } = render(
      <HubAlert variant="critical" title="Build failed" description="Check the workflow log." />,
    )

    expect(screen.getByRole("alert")).toHaveTextContent("Build failed")
    expect(screen.getByRole("alert")).toHaveTextContent("Check the workflow log.")
    expect(container.querySelector("strong.hub-alert__title")).toHaveTextContent("Build failed")
    expect(container.querySelector("span.hub-alert__description")).toHaveTextContent(
      "Check the workflow log.",
    )
  })

  it("uses a polite status for an informational message", () => {
    render(<HubAlert variant="info" title="Changes saved" />)

    expect(screen.getByRole("status")).toHaveTextContent("Changes saved")
  })

  it("uses the reference Note layout for warnings and keeps the icon decorative", () => {
    const { container } = render(<HubAlert variant="warning" title="Repository access changed" />)

    expect(screen.getByRole("alert")).toHaveTextContent("Repository access changed")
    expect(container.querySelector("div.hub-alert--warning")).toBeInTheDocument()
    expect(container.querySelector(".hub-alert__icon")).toHaveAttribute("aria-hidden", "true")
    expect(container.querySelector("p.hub-alert__message")).toBeInTheDocument()
  })

  it("keeps inline actions clickable and dismissal labeled", () => {
    const onAction = vi.fn()
    const onDismiss = vi.fn()
    render(
      <HubAlert
        variant="warning"
        title="Repository access changed"
        action={<button onClick={onAction}>Review access</button>}
        dismissLabel="Dismiss warning"
        onDismiss={onDismiss}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Review access" }))
    fireEvent.click(screen.getByRole("button", { name: "Dismiss warning" }))

    expect(onAction).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
