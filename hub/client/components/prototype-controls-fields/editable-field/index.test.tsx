import { ThemeProvider } from "@primer/react-brand"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { EditableField } from "."
import styles from "../styles.css?inline"
import tokenStyles from "../../../tokens/base.css?inline"

describe("EditableField()", () => {
  it("gives the slider its full row without stretching the numeric value", () => {
    render(
      <ThemeProvider>
        <EditableField
          id="items"
          control={{
            id: "items",
            label: "Items",
            type: "slider",
            default: 3,
            min: 0,
            max: 8,
          }}
          value={3}
          disabled={false}
          onCommit={() => undefined}
        />
      </ThemeProvider>,
    )
    expect(
      screen.getByRole("slider", { name: "Items" }).closest(".controls-field")?.className,
    ).toContain("FormControl--fullWidth")
    expect(screen.getByRole("spinbutton", { name: "Items" }).className).not.toContain(
      "TextInput--fullWidth",
    )
  })
  it("gives both browser slider thumbs a thin theme-aware border and surface", () => {
    const rules = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    for (const selector of [
      ".controls-native-slider::-webkit-slider-thumb",
      ".controls-native-slider::-moz-range-thumb",
    ]) {
      const rule = rules.find(([, candidate]) => candidate?.trim() === selector)
      expect(rule?.[2]).toContain(
        "border: var(--brand-borderWidth-thin) solid var(--hub-border-default);",
      )
      expect(rule?.[2]).toContain("box-sizing: border-box;")
      expect(rule?.[2]).toContain("background: var(--hub-canvas-default);")
      expect(rule?.[2]).toContain("box-shadow: var(--controls-selection-shadow);")
    }
  })

  it("keeps a six-pixel rounded slider track and shares the selected segment's soft shadow", () => {
    const rules = [...styles.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    function body(selector: string) {
      return rules.find(([, candidate]) => candidate?.trim() === selector)?.[2]
    }
    expect(body(".controls-native-slider")).toContain("--controls-slider-track-size: 0.375rem;")
    for (const selector of [
      ".controls-native-slider::-webkit-slider-runnable-track",
      ".controls-native-slider::-moz-range-track",
    ]) {
      expect(body(selector)).toContain("height: var(--controls-slider-track-size);")
      expect(body(selector)).toContain("border-radius: var(--controls-slider-track-size);")
      expect(body(selector)).toContain("background: var(--controls-slider-track-background);")
    }
    expect(body(".controls-fields")).toContain(
      "--controls-selection-shadow: var(--hub-shadow-selection);",
    )
    expect(tokenStyles).toContain("--hub-shadow-selection: 0 0.0625rem 0.1875rem rgb(0 0 0 / 12%);")
    expect(tokenStyles).toContain("--hub-shadow-selection: 0 0.0625rem 0.1875rem rgb(0 0 0 / 35%);")
    expect(body(".controls-segment:has(input:checked)")).toContain(
      "box-shadow: var(--controls-selection-shadow);",
    )
  })

  it.each([
    { min: 0, max: 10, value: 0, progress: 0 },
    { min: 0, max: 10, value: 10, progress: 100 },
    { min: 0.2, max: 1, value: 0.5, progress: 37.5 },
    { min: -10, max: 10, value: -5, progress: 25 },
    { min: 3, max: 3, value: 3, progress: 100 },
  ])(
    "keeps the slider fill in sync for $min to $max at $value",
    ({ min, max, value, progress }) => {
      const { rerender } = render(
        <ThemeProvider>
          <EditableField
            id="opacity"
            control={{
              id: "opacity",
              label: "Opacity",
              type: "slider",
              default: value,
              min,
              max,
              step: 0.1,
            }}
            value={value}
            disabled={false}
            onCommit={() => undefined}
          />
        </ThemeProvider>,
      )
      const slider = screen.getByRole("slider", { name: "Opacity" })
      expect(parseFloat(slider.style.getPropertyValue("--controls-slider-progress"))).toBeCloseTo(
        progress,
      )
      expect(slider).toHaveValue(String(value))
      expect(screen.getByRole("spinbutton", { name: "Opacity" })).toHaveValue(value)
      rerender(
        <ThemeProvider>
          <EditableField
            id="opacity"
            control={{
              id: "opacity",
              label: "Opacity",
              type: "slider",
              default: value,
              min,
              max,
              step: 0.1,
            }}
            value={max}
            disabled={false}
            onCommit={() => undefined}
          />
        </ThemeProvider>,
      )
      expect(slider.style.getPropertyValue("--controls-slider-progress")).toBe("100%")
    },
  )
})
