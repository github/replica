import { describe, expect, it } from "vitest"

import { numericInputWidth } from "."

describe("numericInputWidth()", () => {
  it("omits spinner space for slider inputs", () => {
    expect(
      numericInputWidth({
        id: "opacity",
        label: "Opacity",
        type: "slider",
        min: 0,
        max: 1,
        default: 1,
        step: 0.1,
      }),
    ).toBe("calc(3ch + var(--hub-space-8) * 2)")
  })

  it.each([
    { min: 0, max: 10, default: 2, characters: 2 },
    { min: 0, max: 100, default: 2, characters: 3 },
    { min: -100, max: 10, default: 2, characters: 4 },
    { min: 0, max: 1, default: 0.5, step: 0.1, characters: 3 },
    { min: -10, max: 100, default: 0, step: 0.01, characters: 6 },
    { min: 0.25, max: 10.25, default: 0.25, step: 1, characters: 5 },
    { min: 0, max: 1, default: 0, step: 1e-7, characters: 9 },
    { min: 0, max: 1e22, default: 0, characters: 5 },
    { min: 0, max: 1e-120, default: 0, step: 1e-120, characters: 6 },
  ])("fits bounds and step precision for $min..$max with step $step", (example) => {
    const { characters, ...bounds } = example
    expect(numericInputWidth({ id: "value", label: "Value", type: "number", ...bounds })).toBe(
      `calc(${characters}ch + var(--hub-space-8) * 2 + 1.25rem)`,
    )
  })
})
