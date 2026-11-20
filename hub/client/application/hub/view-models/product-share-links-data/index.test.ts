import { describe, expect, it } from "vitest"

import { createMockStore } from "@application/hub/mocks/create-mock-store"

import { productShareLinksData } from "."

describe("productShareLinksData()", () => {
  it("keeps existing share management available when a Build has no private preview mount", () => {
    const origin = "http://localhost:3000"
    const store = createMockStore({ origin })
    const response = store.product.getShareLinks("2001", "1")
    if (!response.resource.selectedBuild) throw new Error("Expected a successful fixture Build.")
    const number = response.resource.selectedBuild.number
    response.resource.selectedBuild.previewUrl = null
    for (const build of response.resource.prototype.builds) build.previewUrl = null
    const page = productShareLinksData(
      store.getWorkspace(),
      response,
      new URLSearchParams(),
      origin,
    )
    expect(page.managementBuildNumber).toBe(number)
    expect(page.buildOptions.some((build) => build.number === number)).toBe(true)
    expect(page.shareLinks.length).toBeGreaterThan(0)
  })
})
