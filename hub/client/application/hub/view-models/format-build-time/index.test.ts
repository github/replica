import { describe, expect, it, vi } from "vitest"

import { formatBuildTime } from "."

describe("formatBuildTime()", () => {
  it("shows the viewer's timezone for the Build date", () => {
    vi.stubEnv("TZ", "America/Los_Angeles")

    expect(formatBuildTime("2026-01-15T12:00:00Z")).toBe("Jan 15, 2026, 4:00 AM PST")
    expect(formatBuildTime("2026-07-15T12:00:00Z")).toBe("Jul 15, 2026, 5:00 AM PDT")
  })
})
