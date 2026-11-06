import { describe, expect, it } from "vitest"

import { isHubStatusRequest } from "."

describe("isHubStatusRequest()", () => {
  it.each(["/api/hub/status", "/api/hub/open", "/api/hub/activity"])(
    "recognizes the Hub read at %s",
    (path) => expect(isHubStatusRequest(path)).toBe(true),
  )

  it.each(["/api/state", "/api/refresh", "/api/hub/connect"])(
    "does not treat %s as a Hub status read",
    (path) => expect(isHubStatusRequest(path)).toBe(false),
  )
})
