import { describe, expect, it, vi } from "vitest"

import { isMacPlatform } from "."

describe("isMacPlatform()", () => {
  it.each([
    ["MacIntel", true],
    ["MacPPC", true],
    ["Win32", false],
    ["Linux x86_64", false],
    ["", false],
  ])("detects %s", (platform, expected) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform)
    expect(isMacPlatform()).toBe(expected)
  })
})
