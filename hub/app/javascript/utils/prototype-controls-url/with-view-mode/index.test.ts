import { describe, expect, it } from "vitest"

import { withViewMode } from "."

describe("withViewMode()", () => {
  it("adds minimized view last without changing the route, other query values, or fragment", () => {
    expect(
      withViewMode(
        "https://hub.example.com/prototypes/1?build=2&view=expanded&filter=all#comments",
        false,
      ),
    ).toBe("https://hub.example.com/prototypes/1?build=2&filter=all&view=minimized#comments")
  })

  it("removes view when the full Hub interface is requested", () => {
    expect(
      withViewMode("https://hub.example.com/prototypes/1?build=2&view=minimized#comments", true),
    ).toBe("https://hub.example.com/prototypes/1?build=2#comments")
  })
})
