import { describe, expect, it } from "vitest"

import { createControls } from "@utils/prototype-controls/controls.mjs"
import { scopeProjection } from "@utils/prototype-controls-protocol/scope-projection"
import { panelWidth } from "."

const shared = scopeProjection(
  createControls({
    version: 1,
    scope: "widthShared",
    role: "shared",
    panel: { width: 500 },
    controls: [],
  }),
)
const page = scopeProjection(
  createControls({
    version: 1,
    scope: "widthPage",
    role: "page",
    panel: { width: 360 },
    controls: [],
  }),
)
const other = scopeProjection(
  createControls({
    version: 1,
    scope: "widthOther",
    panel: { width: 440 },
    controls: [],
  }),
)
const defaults = scopeProjection(
  createControls({
    version: 1,
    scope: "widthDefault",
    controls: [],
  }),
)

describe("panelWidth()", () => {
  it("uses 288 pixels for existing declarations and empty panels", () => {
    expect(panelWidth([])).toBe(288)
    expect(panelWidth([defaults])).toBe(288)
  })
  it("lets page widths override shared widths regardless of mounting order", () => {
    expect(panelWidth([shared])).toBe(500)
    expect(panelWidth([shared, page])).toBe(360)
    expect(panelWidth([page, shared])).toBe(360)
    expect(panelWidth([shared, defaults])).toBe(288)
  })
  it("uses the widest of simultaneous page sets, not the shared set", () => {
    expect(panelWidth([shared, other, page])).toBe(440)
  })
})
