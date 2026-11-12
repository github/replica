import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HubSwitch } from "."

describe("HubSwitch()", () => {
  it("uses a labeled native checkbox with switch semantics and reports the next state", () => {
    const onChange = vi.fn()
    render(
      <>
        <span id="pins-label">Show pins</span>
        <HubSwitch aria-labelledby="pins-label" checked={false} onChange={onChange} size="small" />
      </>,
    )
    const control = screen.getByRole("switch", { name: "Show pins" })

    expect(control).not.toBeChecked()
    fireEvent.click(control)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("does not toggle when disabled", () => {
    const onChange = vi.fn()
    render(<HubSwitch aria-label="Show resolved" checked={false} onChange={onChange} disabled />)

    fireEvent.click(screen.getByRole("switch"))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("toggles when the visible track is clicked", () => {
    const onChange = vi.fn()
    render(<HubSwitch aria-label="Show pins" checked={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole("switch").closest("label")!)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
