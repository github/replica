import { describe, expect, it } from "vitest"

import { resourcePath } from "."

describe("resourcePath()", () => {
  it("preserves redirect filters and fragments when adding route parameters", () => {
    const result = resourcePath("/notifications?unread=true#notifications", { repositoryId: 2001 })
    const url = new URL(result, "https://hub.example")

    expect(url.pathname).toBe("/notifications")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      unread: "true",
      repositoryId: "2001",
    })
    expect(url.hash).toBe("#notifications")
  })

  it("overrides destination parameters without duplicating them or moving the fragment", () => {
    const result = resourcePath("/settings/audit?scope=hub#events", {
      scope: "repository",
      repositoryId: 2001,
      page: null,
    })
    const url = new URL(result, "https://hub.example")

    expect(url.searchParams.getAll("scope")).toEqual(["repository"])
    expect(url.searchParams.get("repositoryId")).toBe("2001")
    expect(url.searchParams.has("page")).toBe(false)
    expect(url.hash).toBe("#events")
  })

  it("leaves a destination unchanged when there are no additional values", () => {
    expect(resourcePath("/settings/audit?scope=hub#events", { page: null })).toBe(
      "/settings/audit?scope=hub#events",
    )
  })
})
