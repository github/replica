import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"

import { HubSegmentedControl } from "."

describe("HubSegmentedControl()", () => {
  it("labels a native radio group and reports selection changes", () => {
    const onChange = vi.fn()
    render(
      <HubSegmentedControl
        aria-label="Density"
        options={[
          { label: "Comfortable", value: "comfortable" },
          { label: "Compact", value: "compact" },
        ]}
        value="comfortable"
        onChange={onChange}
      />,
    )

    expect(screen.getByRole("radiogroup", { name: "Density" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeChecked()
    const compact = screen.getByRole("radio", { name: "Compact" })
    expect(compact).not.toBeChecked()

    fireEvent.click(compact)
    expect(onChange).toHaveBeenCalledExactlyOnceWith("compact")
  })

  it("supports controlled icon options without exposing decorative icons", () => {
    function Icon(props: ComponentProps<"svg">) {
      return <svg {...props} data-testid="icon" />
    }
    function ControlledControl() {
      const [value, setValue] = useState<"gallery" | "list">("gallery")

      return (
        <HubSegmentedControl
          aria-label="Layout"
          variant="icon"
          options={[
            { icon: Icon, label: "Gallery view", value: "gallery" },
            { icon: Icon, label: "List view", value: "list" },
          ]}
          value={value}
          onChange={setValue}
        />
      )
    }

    render(<ControlledControl />)

    const list = screen.getByRole("radio", { name: "List view" })
    list.focus()
    fireEvent.click(list)

    expect(list).toBeChecked()
    expect(list).toHaveFocus()
    for (const icon of screen.getAllByTestId("icon")) {
      expect(icon).toHaveAttribute("aria-hidden", "true")
    }
  })

  it("disables all options or one option without reporting changes", () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <HubSegmentedControl
        aria-label="Density"
        disabled
        options={[
          { label: "Comfortable", value: "comfortable" },
          { label: "Compact", value: "compact" },
        ]}
        value="comfortable"
        onChange={onChange}
      />,
    )

    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }))
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <HubSegmentedControl
        aria-label="Density"
        options={[
          { label: "Comfortable", value: "comfortable" },
          { disabled: true, label: "Compact", value: "compact" },
        ]}
        value="comfortable"
        onChange={onChange}
      />,
    )
    expect(screen.getByRole("radio", { name: "Compact" })).toBeDisabled()
  })
})
