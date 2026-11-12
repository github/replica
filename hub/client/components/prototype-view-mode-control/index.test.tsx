import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { PrototypeViewModeControl } from "."

describe("PrototypeViewModeControl()", () => {
  it("labels both radio options and reports a layout change", () => {
    const onChange = vi.fn()
    render(
      <PrototypeViewModeControl
        ariaLabel="Prototype layout"
        galleryLabel="Gallery view"
        listLabel="List view"
        value="gallery"
        onChange={onChange}
      />,
    )

    expect(screen.getByRole("radiogroup", { name: "Prototype layout" })).toBeInTheDocument()
    const gallery = screen.getByRole("radio", { name: "Gallery view" })
    const list = screen.getByRole("radio", { name: "List view" })
    expect(gallery).toBeChecked()
    expect(list).not.toBeChecked()
    expect(gallery).toHaveAttribute("type", "radio")
    expect(list).toHaveAttribute("type", "radio")
    expect(gallery.closest("label")?.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    expect(list.closest("label")?.querySelector("svg")).toHaveAttribute("aria-hidden", "true")

    fireEvent.click(list)
    expect(onChange).toHaveBeenCalledExactlyOnceWith("list")
    expect(list).not.toBeChecked()
  })

  it("renders the controlled list selection and reports gallery changes", () => {
    const onChange = vi.fn()
    render(
      <PrototypeViewModeControl
        ariaLabel="Prototype layout"
        galleryLabel="Gallery view"
        listLabel="List view"
        value="list"
        onChange={onChange}
      />,
    )

    expect(screen.getByRole("radio", { name: "List view" })).toBeChecked()
    fireEvent.click(screen.getByRole("radio", { name: "Gallery view" }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("gallery")
  })

  it("retains keyboard focus when activation changes the controlled selection", () => {
    function ControlledToggle() {
      const [value, setValue] = useState<"gallery" | "list">("gallery")

      return (
        <PrototypeViewModeControl
          ariaLabel="Prototype layout"
          galleryLabel="Gallery view"
          listLabel="List view"
          value={value}
          onChange={setValue}
        />
      )
    }

    render(<ControlledToggle />)

    const list = screen.getByRole("radio", { name: "List view" })
    list.focus()
    fireEvent.click(list)

    expect(list).toBeChecked()
    expect(screen.getByRole("radio", { name: "List view" })).toBe(list)
    expect(list).toHaveFocus()
    expect(screen.getByRole("radio", { name: "Gallery view" })).not.toBeChecked()

    const gallery = screen.getByRole("radio", { name: "Gallery view" })
    gallery.focus()
    fireEvent.click(gallery)

    expect(gallery).toBeChecked()
    expect(screen.getByRole("radio", { name: "Gallery view" })).toBe(gallery)
    expect(gallery).toHaveFocus()
  })
})
