import { fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { HubIconButton } from "."

describe("HubIconButton()", () => {
  it("forwards a button ref when no tooltip is rendered", () => {
    const ref = createRef<HTMLButtonElement>()
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} />
    }
    render(<HubIconButton ref={ref} icon={Icon} aria-label="Close" title="Close" />)
    expect(ref.current).toBe(screen.getByRole("button", { name: "Close" }))
  })

  it("names the button, describes the unavailable action, and keeps an ordinary button out of forms", () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} data-testid="icon" />
    }
    const { container } = render(
      <form onSubmit={(event) => event.preventDefault()}>
        <HubIconButton
          ref={ref}
          icon={Icon}
          aria-label="Add comment"
          description="Preview is unavailable"
          onClick={onClick}
        />
      </form>,
    )
    const button = screen.getByRole("button", { name: "Add comment" })

    expect(button).toHaveAttribute("type", "button")
    expect(button).toHaveAccessibleDescription("Preview is unavailable")
    expect(button.className).toContain("Primer_Brand__Button-module__Button")
    expect(screen.getByRole("tooltip", { hidden: true })).toHaveTextContent(
      "Preview is unavailable",
    )
    expect(ref.current).toBe(button)
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("renders navigation as a real link with its label and visit attribute", () => {
    const ref = createRef<HTMLAnchorElement>()
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} />
    }
    render(
      <HubIconButton
        ref={ref}
        as="a"
        href="/builds/3"
        aria-label="Build details"
        description="View the build record"
        icon={Icon}
      />,
    )

    const link = screen.getByRole("link", { name: "Build details" })
    expect(link).toHaveAttribute("href", "/builds/3")
    expect(link).toHaveAccessibleDescription("View the build record")
    expect(ref.current).toBe(link)
    expect(link.className).toContain("Primer_Brand__Button-module__Button")
  })

  it("shows a spinner and marks navigation as busy while loading", () => {
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} data-testid="icon" />
    }
    render(
      <HubIconButton
        as="a"
        href="/prototypes/manage"
        aria-label="Manage prototypes"
        icon={Icon}
        loading
      />,
    )

    const link = screen.getByRole("link", { name: "Manage prototypes" })
    expect(link).toHaveAttribute("aria-busy", "true")
    expect(link.querySelector(".hub-spinner")).toBeInTheDocument()
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument()
  })

  it("keeps explicit titles and descriptions alongside other accessible descriptions", () => {
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} />
    }
    render(
      <>
        <span id="context">Only on published builds</span>
        <HubIconButton
          icon={Icon}
          aria-label="Open preview"
          aria-describedby="context"
          description="Requires a preview"
          title="Open preview"
          variant="invisible"
          size="small"
        />
      </>,
    )

    const button = screen.getByRole("button", { name: "Open preview" })
    expect(button).toHaveAttribute("title", "Open preview")
    expect(button).toHaveAccessibleDescription("Only on published builds Requires a preview")
    expect(button.className).toContain("Button--subtle")
    expect(button).toHaveClass("hub-icon-button--invisible")
    expect(button.className).toContain("Button--size-small")
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument()
  })

  it("respects the native disabled state", () => {
    const onClick = vi.fn()
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} />
    }
    render(
      <HubIconButton
        icon={Icon}
        aria-label="Close"
        description="Wait for the reply"
        variant="danger"
        disabled
        onClick={onClick}
      />,
    )

    const button = screen.getByRole("button", { name: "Close" })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription("Wait for the reply")
    expect(button.className).toContain("Button--secondary")
    expect(button.className).toContain("hub-icon-button--danger")
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button"))
    expect(onClick).not.toHaveBeenCalled()
  })
})
