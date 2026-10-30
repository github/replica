import { ThemeProvider } from "@primer/react-brand"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import panelStyles from "../prototype-controls-panel/styles.css?inline"
import meta, {
  Actions,
  ChoiceRows,
  ConditionalFields,
  LongLabels,
  NumericLabels,
  ScopeDividers,
  ScopeDividersPanel,
} from "./stories"

describe("Controls examples", () => {
  it("toggles an ungrouped first field without changing group folds or scope separators", async () => {
    const { container } = render(
      <ThemeProvider colorMode="auto">{ScopeDividersPanel.render()}</ThemeProvider>,
    )
    const flushRule = [...panelStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(([, , body]) =>
      body?.includes("padding-top: 0;"),
    )
    if (!flushRule?.[1]) throw new Error("The group-first panel must have a flush top rule.")
    const flushSelector = flushRule[1].trim()
    const content = container.querySelector(".canvas-controls-content")
    if (!content) throw new Error("The example must render panel content.")
    expect(content.matches(flushSelector)).toBe(true)
    expect(screen.queryByRole("textbox", { name: "Preview title" })).not.toBeInTheDocument()
    const copilot = screen.getByRole("group", { name: "Copilot" })
    expect(copilot.parentElement?.firstElementChild).toBe(copilot)
    fireEvent.click(screen.getByRole("button", { name: "Collapse Copilot" }))
    fireEvent.click(screen.getByRole("button", { name: "Show ungrouped field" }))
    const field = screen.getByRole("textbox", { name: "Preview title" })
    expect(content.matches(flushSelector)).toBe(false)
    expect(copilot.parentElement?.firstElementChild).toContainElement(field)
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    fireEvent.change(field, { target: { value: "Keep this title" } })
    await waitFor(() => expect(field).toHaveValue("Keep this title"))
    fireEvent.click(screen.getByRole("button", { name: "Hide ungrouped field" }))
    expect(content.matches(flushSelector)).toBe(true)
    expect(copilot.parentElement?.firstElementChild).toBe(copilot)
    expect(screen.getByRole("button", { name: "Expand Copilot" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show ungrouped field" }))
    expect(screen.getByRole("textbox", { name: "Preview title" })).toHaveValue("Keep this title")
    expect(container.querySelectorAll(".canvas-controls-footer")).toHaveLength(0)
  })

  it("keeps the single Composer header, folds, focus and header Reset in the real panel", async () => {
    const { container } = render(
      <ThemeProvider colorMode="auto">{ScopeDividersPanel.render()}</ThemeProvider>,
    )
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Show Composer only" }))
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
    const field = screen.getByRole("checkbox", { name: "Selector loading" })
    fireEvent.click(field)
    await waitFor(() => expect(field).toBeChecked())
    fireEvent.click(screen.getByRole("button", { name: "Collapse Composer" }))
    expect(field).not.toBeVisible()
    expect(screen.getByRole("button", { name: "Expand Composer" })).toHaveFocus()
    expect(container.querySelector(".canvas-controls-header")).toContainElement(
      screen.getByRole("button", { name: "Reset all controls" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Reset all controls" }))
    await waitFor(() => expect(field).not.toBeChecked())
    fireEvent.click(screen.getByRole("button", { name: "Expand Composer" }))
    expect(field).toBeVisible()
    expect(screen.getByRole("button", { name: "Collapse Composer" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Show all scopes" }))
    expect(screen.getAllByRole("separator")).toHaveLength(3)
  })

  it("keeps one separator per visible scope boundary in the four-group example", async () => {
    render(<ThemeProvider colorMode="auto">{ScopeDividers.render()}</ThemeProvider>)
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    const title = screen.getByRole("textbox", { name: "Composer placeholder" })
    fireEvent.change(title, { target: { value: "Retain this draft" } })
    await waitFor(() => expect(title).toHaveValue("Retain this draft"))
    fireEvent.click(screen.getByRole("button", { name: "Collapse Dashboard preview" }))
    expect(title).not.toBeVisible()
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Hide Dashboard" }))
    expect(screen.getAllByRole("separator")).toHaveLength(2)
    expect(screen.queryByRole("group", { name: "Dashboard preview" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show Dashboard" }))
    expect(screen.getAllByRole("separator")).toHaveLength(3)
    fireEvent.click(screen.getByRole("button", { name: "Expand Dashboard preview" }))
    expect(screen.getByRole("textbox", { name: "Composer placeholder" })).toHaveValue(
      "Retain this draft",
    )
  })

  it("keeps inline dropdowns and centered radio rows labelled and interactive", async () => {
    render(<ThemeProvider colorMode="auto">{ChoiceRows.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    const layout = screen.getByRole("combobox", { name: "Layout" })
    expect(layout).toHaveClass("controls-select-input")
    expect(layout.closest(".controls-field")).toHaveClass("controls-field--select")
    fireEvent.change(layout, { target: { value: "Grid" } })
    await waitFor(() => expect(layout).toHaveValue("Grid"))
    const longOption = screen.getByRole("combobox", { name: "Layout options" })
    expect(
      within(longOption).getByRole("option", {
        name: "A detailed grid with additional information",
      }),
    ).toBeInTheDocument()
    expect(longOption).toHaveValue("List")
    expect(
      screen.getByRole("combobox", {
        name: "Layout of the notes displayed in the current preview",
      }),
    ).toHaveValue("List")
    fireEvent.click(screen.getByText("Center all the notes and their descriptions in the preview"))
    await waitFor(() =>
      expect(
        screen.getByRole("radio", {
          name: "Center all the notes and their descriptions in the preview",
        }),
      ).toBeChecked(),
    )
    const radio = screen.getByRole("radio", { name: "Center" })
    expect(radio.closest(".controls-field")).toHaveClass("controls-choice-row")
    expect(radio.parentElement?.querySelector(".controls-choice-mark")).toHaveClass(
      "controls-choice-mark--radio",
    )
  })

  it("keeps numeric rows labelled, exposes live slider values, and places validation below the row", async () => {
    render(<ThemeProvider colorMode="auto">{NumericLabels.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    const count = screen.getByRole("spinbutton", { name: "Item count" })
    expect(count).toHaveClass("controls-number-input")
    expect(count.closest(".controls-field")).toHaveClass("controls-field--number")
    expect(
      screen.getByRole("spinbutton", {
        name: "Maximum number of notes visible in the current preview",
      }),
    ).toHaveValue(12)
    const slider = screen.getByRole("slider", { name: "Opacity" })
    const value = screen.getByRole("spinbutton", { name: "Opacity" })
    expect(value).toHaveValue(1)
    expect(value.parentElement?.parentElement).toHaveClass("controls-slider-row")
    expect(value).toHaveClass("controls-number-input--slider")
    expect(slider).toHaveAttribute("step", "0.1")
    expect(value).toHaveAttribute("step", "0.1")
    expect(count).toHaveAttribute("step", "1")
    fireEvent.change(slider, { target: { value: "0.3" } })
    await waitFor(() => {
      expect(value).toHaveValue(0.3)
      expect(slider).toHaveAccessibleName("Opacity")
    })
    if (!(value instanceof HTMLInputElement)) throw new Error("The slider value must be an input.")
    value.stepUp()
    fireEvent.change(value, { target: { value: value.value } })
    await waitFor(() => expect(slider).toHaveValue("0.4"))
    value.stepDown()
    fireEvent.change(value, { target: { value: value.value } })
    await waitFor(() => expect(slider).toHaveValue("0.3"))
    fireEvent.change(value, { target: { value: "0.7" } })
    await waitFor(() => expect(slider).toHaveValue("0.7"))
    fireEvent.change(value, { target: { value: "0.75" } })
    expect(value).toHaveAttribute("aria-invalid", "true")
    expect(slider).toHaveValue("0.7")
    expect(screen.getByText("must align with step (anchored at min)")).toBeInTheDocument()
    fireEvent.blur(value)
    expect(value).toHaveValue(0.7)
    fireEvent.change(value, { target: { value: "" } })
    expect(value).toHaveValue(null)
    expect(slider).toHaveValue("0.7")
    fireEvent.blur(value)
    expect(value).toHaveValue(0.7)
    fireEvent.change(value, { target: { value: "2" } })
    expect(value).toHaveAttribute("aria-invalid", "true")
    expect(slider).toHaveValue("0.7")
    fireEvent.blur(value)
    fireEvent.change(count, { target: { value: "101" } })
    expect(count).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("must be <= max")).toHaveClass("controls-field-validation")
    fireEvent.blur(count)
    expect(count).toHaveValue(3)
    fireEvent.change(count, { target: { value: "3.5" } })
    expect(count).toHaveAttribute("aria-invalid", "true")
    fireEvent.blur(count)
    expect(count).toHaveValue(3)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    await waitFor(() => {
      expect(value).toHaveValue(1)
      expect(slider).toHaveValue("1")
    })
  })

  it("keeps full long segmented labels accessible and selectable without changing the type", async () => {
    render(<ThemeProvider colorMode="auto">{LongLabels.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    const label = screen.getByTitle("Compact information layout")
    expect(label).toHaveClass("controls-segment")
    expect(screen.getByRole("radio", { name: "Compact information layout" })).not.toBeChecked()
    fireEvent.click(label)
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Compact information layout" })).toBeChecked(),
    )
    expect(
      screen.getByRole("combobox", { name: "Long labels in a dropdown (recommended)" }),
    ).toHaveValue("Comfortable reading layout")
  })

  it("updates live values and resets all fields", async () => {
    render(<ThemeProvider colorMode="auto">{meta.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    fireEvent.click(screen.getByRole("button", { name: "Add item" }))
    const values = within(screen.getByRole("complementary"))
    await waitFor(() => expect(values.getByText("3")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    expect(screen.getByLabelText("Item count")).toHaveValue(2)
    expect(values.getByText("2")).toBeInTheDocument()
  })

  it("uses Brand fields and validation without changing their control values", async () => {
    render(<ThemeProvider colorMode="dark">{meta.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    const count = screen.getByRole("spinbutton", { name: "Item count" })
    expect(count.className).toContain("TextInput")
    expect(screen.getByRole("textbox", { name: "Title" }).className).toContain("TextInput")
    expect(screen.getByRole("textbox", { name: "Description" }).className).toContain("Textarea")
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveAttribute("rows", "2")
    expect(screen.getByRole("combobox", { name: "Layout" }).className).toContain("Select")
    expect(screen.getByRole("checkbox", { name: "Show details" }).className).toContain("Checkbox")
    expect(screen.getByRole("radio", { name: "high" }).className).toContain("Radio")
    expect(screen.getByRole("radio", { name: "B" }).className).toContain("Radio")
    expect(screen.getByRole("checkbox", { name: "badges" }).className).toContain("Checkbox")
    expect(screen.getByRole("slider", { name: "Opacity" })).toHaveClass("controls-native-slider")
    expect(screen.getByLabelText("Accent")).toHaveClass("controls-native-color")
    expect(screen.getByRole("button", { name: "Add item" }).className).toContain("Button")

    fireEvent.change(count, { target: { value: "11" } })
    expect(count).toHaveAttribute("aria-invalid", "true")
    expect(count).toHaveAttribute("aria-describedby", expect.stringContaining("-validation"))
    expect(screen.getByText("must be <= max")).toHaveAttribute("aria-live", "polite")
    fireEvent.blur(count)
    expect(count).toHaveValue(2)
    expect(screen.queryByText("must be <= max")).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox", { name: "Layout" }), {
      target: { value: "grid" },
    })
    fireEvent.click(screen.getByRole("radio", { name: "high" }))
    fireEvent.click(screen.getByRole("radio", { name: "B" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "badges" }))
    fireEvent.change(screen.getByRole("slider", { name: "Opacity" }), { target: { value: "0.5" } })
    fireEvent.change(screen.getByLabelText("Accent"), { target: { value: "#aabbcc" } })
    const values = within(screen.getByRole("complementary"))
    await waitFor(() => {
      expect(values.getByText('"grid"')).toBeInTheDocument()
      expect(values.getByText('"high"')).toBeInTheDocument()
      expect(values.getByText('"B"')).toBeInTheDocument()
      expect(values.getByText('["badges"]')).toBeInTheDocument()
      expect(values.getByText("0.5")).toBeInTheDocument()
      expect(values.getByText('"#aabbcc"')).toBeInTheDocument()
    })
  })

  it("resets the three B fields when switching back to A", async () => {
    render(<ThemeProvider colorMode="auto">{ConditionalFields.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    expect(screen.getByLabelText("Heading")).toBeInTheDocument()
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: "B" }))
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument())
    expect(screen.getByLabelText("Item count")).toBeInTheDocument()
    expect(screen.getByLabelText("Show badges")).toBeInTheDocument()
    expect(screen.queryByLabelText("Heading")).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed title" } })
    fireEvent.blur(screen.getByLabelText("Title"))
    await waitFor(() =>
      expect(
        within(screen.getByRole("complementary")).getByText('"Changed title"'),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole("radio", { name: "A" }))
    await waitFor(() => expect(screen.getByLabelText("Heading")).toBeInTheDocument())
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("complementary")).getByText('"Detailed layout"'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole("radio", { name: "B" }))
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Detailed layout"))
  })

  it("folds schema groups without resetting their values or unmounting their fields", async () => {
    render(<ThemeProvider colorMode="auto">{meta.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    const title = screen.getByRole("textbox", { name: "Title" })
    fireEvent.change(title, { target: { value: "Keep this value" } })
    const values = within(screen.getByRole("complementary"))
    await waitFor(() => expect(values.getByText('"Keep this value"')).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Collapse Details" }))
    expect(title).not.toBeVisible()
    expect(title).toHaveValue("Keep this value")
    expect(values.getByText('"Keep this value"')).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Expand Details" }))
    expect(title).toBeVisible()
    expect(title).toHaveValue("Keep this value")
  })

  it("shows unavailable, busy, completed, and failed actions", async () => {
    vi.useFakeTimers()
    render(<ThemeProvider colorMode="auto">{Actions.render()}</ThemeProvider>)
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    expect(screen.getByRole("button", { name: "Action without a handler" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Run example action" }))
    expect(screen.getByRole("button", { name: /Run example action/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Run example action/ })).toHaveAttribute(
      "aria-busy",
      "true",
    )
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByLabelText("Result")).toHaveValue("Action completed")
    expect(screen.getByRole("button", { name: "Run example action" })).toBeEnabled()
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Simulate an error"))
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole("button", { name: "Run example action" }))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByRole("alert")).toHaveTextContent("The example action failed")
    expect(screen.getByRole("button", { name: "Run example action" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Reset example" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Result")).toHaveValue("Not run yet")
  })
})
