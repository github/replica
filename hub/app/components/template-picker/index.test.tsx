import { fireEvent, render, screen } from "@testing-library/react"
import { describe, it, vi } from "vitest"

import { HubThemeProvider } from "@hooks/use-hub-theme"

import { TemplatePicker } from "."

describe("TemplatePicker()", () => {
  it("uses Hub's dark thumbnail and does not hide a working light image after a dark failure", () => {
    const picker = (
      <TemplatePicker
        templates={[
          {
            id: "default",
            name: "Default",
            route: "/",
            screenshotSrc: "/desktop",
            darkScreenshotSrc: "/desktop?theme=dark",
          },
        ]}
        selectedId="default"
        onChange={vi.fn()}
        label="Template"
        unavailableLabel="Preview unavailable"
      />
    )
    const { rerender } = render(<HubThemeProvider colorMode="dark">{picker}</HubThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Template: Default" }))
    const option = screen.getByRole("option")
    const image = option.querySelector("img")!
    expect(image).toHaveAttribute("src", "/desktop?theme=dark")
    fireEvent.error(image)
    expect(screen.getByRole("img", { name: "Preview unavailable" })).toBeInTheDocument()

    rerender(<HubThemeProvider colorMode="light">{picker}</HubThemeProvider>)
    expect(option.querySelector("img")).toHaveAttribute("src", "/desktop")
  })

  it.each(["ArrowDown", "ArrowUp"])(
    "restores option focus with %s and closes with Escape after returning to the trigger",
    (key) => {
      const onChange = vi.fn()
      render(
        <TemplatePicker
          templates={[
            { id: "default", name: "Default", route: "/" },
            { id: "settings", name: "Settings", route: "/settings" },
          ]}
          selectedId="default"
          onChange={onChange}
          label="Template"
          unavailableLabel="Preview unavailable"
        />,
      )
      const trigger = screen.getByRole("button", { name: "Template: Default" })
      fireEvent.keyDown(trigger, { key: "ArrowDown" })
      const options = screen.getAllByRole("option")
      expect(options[0]).toHaveFocus()
      fireEvent.keyDown(options[0]!, { key: "Tab", shiftKey: true })
      trigger.focus()
      expect(screen.getByRole("listbox")).toBeInTheDocument()
      fireEvent.keyDown(trigger, { key })
      expect(options[0]).toHaveFocus()

      fireEvent.keyDown(options[0]!, { key: "ArrowDown" })
      expect(options[1]).toHaveFocus()
      fireEvent.keyDown(options[1]!, { key: "Tab", shiftKey: true })
      trigger.focus()
      fireEvent.keyDown(trigger, { key })
      expect(options[1]).toHaveFocus()
      fireEvent.keyDown(options[1]!, { key: "Tab", shiftKey: true })
      trigger.focus()
      fireEvent.keyDown(trigger, { key: "Escape" })
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it("supports keyboard browsing without selecting until activation, and restores trigger focus", () => {
    const onChange = vi.fn()
    render(
      <TemplatePicker
        templates={[
          { id: "default", name: "Default", route: "/" },
          { id: "settings", name: "Settings", route: "/settings" },
          { id: "welcome", name: "Welcome", route: "/welcome" },
        ]}
        selectedId="default"
        onChange={onChange}
        label="Template"
        unavailableLabel="Preview unavailable"
      />,
    )
    const trigger = screen.getByRole("button", { name: "Template: Default" })
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const options = screen.getAllByRole("option")
    expect(options[0]).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    fireEvent.keyDown(options[0]!, { key: "End" })
    expect(options[2]).toHaveFocus()
    fireEvent.keyDown(options[2]!, { key: "ArrowDown" })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(options[0]!, { key: "ArrowUp" })
    expect(options[2]).toHaveFocus()
    fireEvent.keyDown(options[2]!, { key: "Home" })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(options[0]!, { key: "s" })
    expect(options[1]).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(options[1]!)
    expect(onChange).toHaveBeenCalledExactlyOnceWith("settings")
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getAllByRole("option")[0]!, { key: "Escape" })
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("dismisses on outside interaction and when focus leaves without changing the selection", () => {
    const onChange = vi.fn()
    render(
      <>
        <TemplatePicker
          templates={[{ id: "default", name: "Default", route: "/" }]}
          selectedId="default"
          onChange={onChange}
          label="Template"
          unavailableLabel="Preview unavailable"
        />
        <button type="button">Add details</button>
      </>,
    )
    const trigger = screen.getByRole("button", { name: "Template: Default" })
    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole("button", { name: "Add details" }))
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.blur(screen.getByRole("option"), {
      relatedTarget: screen.getByRole("button", { name: "Add details" }),
    })
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("shows thumbnails and an explicit placeholder for missing or failed screenshots", () => {
    render(
      <TemplatePicker
        templates={[
          { id: "default", name: "Default", route: "/" },
          { id: "settings", name: "Settings", route: "/settings", screenshotSrc: "/settings.png" },
        ]}
        selectedId="default"
        onChange={vi.fn()}
        label="Template"
        unavailableLabel="Preview unavailable"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Template: Default" }))
    expect(screen.getAllByRole("img", { name: "Preview unavailable" })).toHaveLength(1)
    const image = screen.getByRole("option", { name: "Settings /settings" }).querySelector("img")!
    expect(image).toHaveAttribute("src", "/settings.png")
    expect(image).toHaveAttribute("alt", "")
    fireEvent.error(image)
    expect(screen.getAllByRole("img", { name: "Preview unavailable" })).toHaveLength(2)
  })
})
