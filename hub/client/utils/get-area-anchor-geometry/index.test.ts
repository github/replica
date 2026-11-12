import { describe, expect, it } from "vitest"

import { getAreaAnchorGeometry } from "."

describe("getAreaAnchorGeometry()", () => {
  it("maps a normalized stroke and chooses its top-right pin point", () => {
    const geometry = getAreaAnchorGeometry(
      {
        schemaVersion: 1,
        kind: "area",
        route: { pathname: "/", search: "", hash: "" },
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        rect: { x: 20, y: 30, width: 100, height: 50 },
        viewport: { width: 1_280, height: 720, scrollX: 0, scrollY: 0 },
        elements: [],
      },
      { x: 10, y: 15, width: 200, height: 80 },
    )

    expect(geometry.path).toEqual([
      { x: 10, y: 15 },
      { x: 210, y: 15 },
      { x: 210, y: 95 },
    ])
    expect(geometry.point).toEqual({ x: 210, y: 15 })
  })
})
