import { ThemeProvider } from "@primer/react-brand"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeAll, describe, expect, it } from "vitest"

import { AllControlsExample } from "."
import tokenStyles from "../../../tokens/base.css?inline"
import fieldStyles from "../../prototype-controls-fields/styles.css?inline"
import panelStyles from "../styles.css?inline"

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: { configurable: true, value() {} },
    hidePopover: { configurable: true, value() {} },
  })
})

describe("AllControlsExample()", () => {
  it("limits compact dropdown-colored button tokens to enabled action fields", () => {
    render(
      <ThemeProvider colorMode="auto">
        <AllControlsExample />
      </ThemeProvider>,
    )
    const panel = within(screen.getByRole("complementary", { name: "Controls" }))
    const action = panel.getByRole("button", { name: "Shuffle notes" })
    const actionRules = [...fieldStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(
      ([, selector, body]) =>
        selector?.includes(".controls-action-button") && body?.includes("--brand-"),
    )
    expect(action).toHaveClass("controls-action-button")
    expect(actionRules).toHaveLength(2)
    const typography = actionRules.find(([, , body]) => body?.includes("--brand-text-size-100:"))
    const colors = actionRules.find(([, , body]) =>
      body?.includes("--brand-button-secondary-bgColor-rest:"),
    )
    if (!typography?.[1] || !colors?.[1])
      throw new Error("Action fields need scoped typography and resting-color rules.")
    expect(action.matches(typography[1].trim())).toBe(true)
    expect(typography[2]).toContain("--brand-text-size-100: var(--hub-text-size-small);")
    expect(action.matches(colors[1].trim())).toBe(true)
    expect(colors[2]).toContain("--brand-button-secondary-bgColor-rest: var(--hub-canvas-muted);")
    expect(colors[2]).toContain(
      "--brand-button-secondary-fgColor-rest: var(--brand-control-color-fg-default);",
    )
    expect(colors[2]).toContain(
      "--brand-button-secondary-borderColor-rest: var(--brand-control-color-border-default);",
    )
    expect(colors[2]).not.toMatch(/hover|active|disabled|focus|outline/)
    for (const element of [
      panel.getByRole("button", { name: "Reset all controls" }),
      panel.getByRole("button", { name: "Collapse controls" }),
      panel.getByRole("button", { name: "Collapse Content" }),
      panel.getByRole("button", { name: "Move controls" }),
      screen.getByRole("button", { name: "Controls" }),
      screen.getByRole("button", { name: "Shuffle from the page" }),
      panel.getByRole("combobox", { name: "Layout" }),
    ]) {
      expect(actionRules.some(([, selector]) => element.matches(selector?.trim() ?? ""))).toBe(
        false,
      )
    }
    action.setAttribute("disabled", "")
    expect(action.matches(colors[1].trim())).toBe(false)
    expect(action.matches(typography[1].trim())).toBe(true)
  })

  it("applies the dark raised-shadow override to the standalone canvas theme root", () => {
    const { container } = render(
      <ThemeProvider colorMode="dark" className="canvas-base">
        <AllControlsExample />
      </ThemeProvider>,
    )
    const theme = container.querySelector(".canvas-base")
    if (!theme) throw new Error("The standalone canvas needs a theme root.")
    expect(theme).toHaveAttribute("data-color-mode", "dark")
    expect(theme).not.toHaveClass("hub-theme")
    const darkRule = [...tokenStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
      ([, selector, body]) =>
        selector?.trim() === '[data-color-mode="dark"]' &&
        body?.includes("--hub-shadow-control-raised"),
    )
    if (!darkRule?.[1]) throw new Error("Control shadows need a standalone dark theme override.")
    expect(theme.matches(darkRule[1].trim())).toBe(true)
    expect(darkRule[2]).toContain(
      "--hub-shadow-control-raised: 0 0.0625rem 0.125rem rgb(0 0 0 / 20%);",
    )
    expect(darkRule[2]).toContain(
      "0 0.0625rem 0 rgb(0 0 0 / 28%), 0 0.125rem 0.125rem rgb(0 0 0 / 5%);",
    )
  })

  it("raises dropdowns and action buttons while leaving editable fields and ghost controls flat", () => {
    render(
      <ThemeProvider colorMode="auto">
        <AllControlsExample />
      </ThemeProvider>,
    )
    const panel = within(screen.getByRole("complementary", { name: "Controls" }))
    const segments = panel.getByRole("radio", { name: "Comfortable" }).closest(".controls-segments")
    if (!segments) throw new Error("The density choices need a segmented control surface.")
    const segmentedRule = [...fieldStyles.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find(
      ([, selector]) => selector?.trim() === ".controls-segments",
    )
    expect(segmentedRule?.[2]).toContain(
      "border: var(--brand-borderWidth-thin) solid var(--hub-border-muted);",
    )
    const shadowRules = [...(fieldStyles + panelStyles).matchAll(/([^{}]+)\{([^{}]+)\}/g)]
      .filter(([, , body]) => body?.includes("box-shadow: var(--hub-shadow-control-"))
      .map(([, selector, body]) => {
        if (!selector || !body) throw new Error("A control shadow needs a selector and value.")
        return {
          selector: selector.trim(),
          shadow: body.match(/box-shadow:\s*([^;]+);/)?.[1],
        }
      })
    const raisedControls = [
      panel.getByRole("combobox", { name: "Layout" }),
      panel.getByRole("combobox", { name: "Presentation of the notes in each card" }),
      panel.getByRole("button", { name: "Shuffle notes" }),
    ]
    for (const element of raisedControls) {
      const rules = shadowRules.filter(({ selector }) => element.matches(selector))
      expect(rules).toHaveLength(1)
      expect(rules[0]?.shadow).toBe("var(--hub-shadow-control-field)")
      expect(rules[0]?.selector).toContain(":not(:disabled)")
      expect(rules[0]?.selector).toContain(":focus-visible")
      element.setAttribute("disabled", "")
      expect(element.matches(rules[0]?.selector ?? "")).toBe(false)
      element.removeAttribute("disabled")
    }
    for (const element of [
      panel.getByRole("textbox", { name: "Title" }),
      panel.getByRole("textbox", { name: "Description" }),
      panel.getByRole("spinbutton", { name: "Item count" }),
      panel.getByRole("spinbutton", { name: "Card opacity" }),
      panel.getByLabelText("Accent color"),
      panel.getByRole("checkbox", { name: "Show description" }),
      panel.getByRole("radio", { name: "Left" }),
      panel.getByRole("radio", { name: "Comfortable" }),
      panel.getByRole("slider", { name: "Card opacity" }),
      panel.getByRole("button", { name: "Collapse Content" }),
      panel.getByRole("button", { name: "Collapse controls" }),
      panel.getByRole("button", { name: "Move controls" }),
      panel.getByRole("button", { name: "Reset all controls" }),
      screen.getByRole("button", { name: "Controls" }),
      screen.getByRole("button", { name: "Shuffle from the page" }),
    ]) {
      expect(shadowRules.some(({ selector }) => element.matches(selector))).toBe(false)
    }
    expect(panel.getByRole("button", { name: "Reset all controls" })).toHaveClass(
      "controls-ghost-button",
    )
    expect(tokenStyles).toContain(
      "0 0.0625rem 0 rgb(0 0 0 / 3%), 0 0.125rem 0.125rem rgb(0 0 0 / 2%);",
    )
    const fieldRule = shadowRules.find(({ shadow }) => shadow === "var(--hub-shadow-control-field)")
    expect(fieldRule?.selector).toContain(":is(.controls-select-input, .controls-action-button)")
  })

  it("renders all eleven types and applies every control to the live page", async () => {
    render(
      <ThemeProvider colorMode="auto">
        <AllControlsExample />
      </ThemeProvider>,
    )
    let panel = within(screen.getByRole("complementary", { name: "Controls" }))
    const page = within(screen.getByRole("region", { name: "Live example page" }))
    fireEvent.click(panel.getByRole("button", { name: "Reset all controls" }))
    expect(page.getAllByRole("article")).toHaveLength(3)
    const contentGroup = panel.getByRole("group", { name: "Content" })
    for (const name of ["Title", "Description"]) {
      const field = panel.getByRole("textbox", { name })
      expect(contentGroup).not.toContainElement(field)
      expect(field.compareDocumentPosition(contentGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      )
    }

    fireEvent.change(panel.getByRole("textbox", { name: "Title" }), {
      target: { value: "My notes" },
    })
    fireEvent.change(panel.getByRole("textbox", { name: "Description" }), {
      target: { value: "Updated description" },
    })
    fireEvent.change(panel.getByRole("spinbutton", { name: "Item count" }), {
      target: { value: "2" },
    })
    await waitFor(() => {
      expect(page.getByRole("heading", { name: "My notes" })).toBeInTheDocument()
      expect(page.getByText("Updated description")).toBeInTheDocument()
      expect(page.getAllByRole("article")).toHaveLength(2)
    })
    const notePresentation = panel.getByRole("combobox", {
      name: "Presentation of the notes in each card",
    })
    fireEvent.change(notePresentation, { target: { value: "Short summaries of each note" } })
    await waitFor(() => expect(page.getAllByText("A short note to explore.")).toHaveLength(2))
    fireEvent.change(notePresentation, { target: { value: "Detailed descriptions of each note" } })
    await waitFor(() =>
      expect(
        page.getAllByText("Try changing the content, layout, density, and color."),
      ).toHaveLength(2),
    )
    fireEvent.click(panel.getByRole("checkbox", { name: "Show description" }))
    fireEvent.click(panel.getByRole("checkbox", { name: "Badges" }))
    fireEvent.click(panel.getByRole("checkbox", { name: "Notes" }))
    await waitFor(() => {
      expect(page.queryByText("Updated description")).not.toBeInTheDocument()
      expect(page.queryByText("Ready to explore")).not.toBeInTheDocument()
      expect(
        page.queryAllByText("Try changing the content, layout, density, and color."),
      ).toHaveLength(0)
    })
    fireEvent.change(panel.getByRole("combobox", { name: "Layout" }), {
      target: { value: "Grid" },
    })
    fireEvent.click(panel.getByRole("radio", { name: "Center" }))
    fireEvent.click(panel.getByRole("radio", { name: "Compact" }))
    fireEvent.change(panel.getByRole("slider", { name: "Card opacity" }), {
      target: { value: "0.5" },
    })
    fireEvent.change(panel.getByLabelText("Accent color"), { target: { value: "#ff0000" } })
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Live example page" })).toHaveStyle({
        textAlign: "center",
      })
      const card = page.getAllByRole("article")[0]
      if (!card) throw new Error("The example must render a note.")
      expect(card).toHaveStyle({ opacity: "0.5", borderColor: "#ff0000" })
      expect(card.parentElement).toHaveAttribute("data-layout", "Grid")
      expect(card.parentElement).toHaveAttribute("data-density", "Compact")
    })
    fireEvent.click(panel.getByRole("button", { name: "Shuffle notes" }))
    await waitFor(() => expect(page.getByText("Notes shuffled: 1")).toBeInTheDocument())
    fireEvent.click(page.getByRole("button", { name: "Shuffle from the page" }))
    expect(page.getByText("Notes shuffled: 2")).toBeInTheDocument()

    fireEvent.click(panel.getByRole("button", { name: "Collapse Content" }))
    expect(panel.getByRole("textbox", { name: "Title" })).toBeVisible()
    expect(panel.getByRole("textbox", { name: "Description" })).toBeVisible()
    expect(panel.getByRole("spinbutton", { name: "Item count", hidden: true })).not.toBeVisible()
    fireEvent.click(panel.getByRole("button", { name: "Collapse controls" }))
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    expect(screen.queryByRole("complementary", { name: "Controls" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Controls" }))
    panel = within(screen.getByRole("complementary", { name: "Controls" }))
    fireEvent.click(panel.getByRole("button", { name: "Expand controls" }))
    expect(panel.getByLabelText("Title")).toBeVisible()
    expect(panel.getByLabelText("Item count")).not.toBeVisible()
    expect(page.getByRole("heading", { name: "My notes" })).toBeInTheDocument()
    fireEvent.click(panel.getByRole("button", { name: "Expand Content" }))
    fireEvent.click(panel.getByRole("button", { name: "Reset all controls" }))
    await waitFor(() => {
      expect(page.getByRole("heading", { name: "Field notes" })).toBeInTheDocument()
      expect(page.getAllByRole("article")).toHaveLength(3)
      expect(page.getByText("Notes shuffled: 0")).toBeInTheDocument()
      expect(panel.getByRole("checkbox", { name: "Show description" })).toBeChecked()
      expect(panel.getByRole("checkbox", { name: "Badges" })).toBeChecked()
      expect(panel.getByRole("checkbox", { name: "Notes" })).toBeChecked()
      expect(panel.getByRole("combobox", { name: "Layout" })).toHaveValue("List")
      expect(
        panel.getByRole("combobox", { name: "Presentation of the notes in each card" }),
      ).toHaveValue("Detailed descriptions of each note")
      expect(panel.getByRole("radio", { name: "Left" })).toBeChecked()
      expect(panel.getByRole("radio", { name: "Comfortable" })).toBeChecked()
      expect(panel.getByRole("slider", { name: "Card opacity" })).toHaveValue("1")
      expect(panel.getByLabelText("Accent color")).toHaveValue("#336699")
    })
  })
})
