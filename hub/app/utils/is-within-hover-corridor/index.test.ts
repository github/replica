import { describe, expect, it } from "vitest"

import { isWithinHoverCorridor } from "."

describe("isWithinHoverCorridor()", () => {
  const bounds = { left: 100, right: 300, top: 0, bottom: 100 }
  const origin = { x: 0, y: 50 }

  it("includes diagonal paths toward both ends of the card but not movement away", () => {
    expect(isWithinHoverCorridor({ x: 80, y: 90 }, origin, bounds)).toBe(true)
    expect(isWithinHoverCorridor({ x: 80, y: 10 }, origin, bounds)).toBe(true)
    expect(isWithinHoverCorridor({ x: 20, y: 100 }, origin, bounds)).toBe(false)
    expect(isWithinHoverCorridor({ x: -20, y: 50 }, origin, bounds)).toBe(false)
  })

  it("supports a card placed below the trigger in a narrow layout", () => {
    expect(
      isWithinHoverCorridor(
        { x: 70, y: 80 },
        { x: 50, y: 0 },
        { left: 0, right: 100, top: 100, bottom: 300 },
      ),
    ).toBe(true)
  })

  it("does not keep an unrelated area active when leaving the card itself", () => {
    expect(isWithinHoverCorridor({ x: 500, y: 50 }, { x: 200, y: 50 }, bounds)).toBe(false)
  })
})
