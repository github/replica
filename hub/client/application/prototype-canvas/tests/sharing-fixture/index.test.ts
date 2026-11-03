import { describe, expect, it } from "vitest"

import { publicationHub, publicationState } from "@utils/resolve-prototype-publication/fixtures"
import { sharingFixture } from "."

describe("sharingFixture()", () => {
  it("copies incoming records instead of changing another case's checkout", () => {
    const first = sharingFixture(publicationState, publicationHub)
    first.fixture.state.stats.branch = "prototype/other"
    first.fixture.hub.hubOrigin = "https://other.example.com"
    const next = sharingFixture(publicationState, publicationHub)
    expect(next.fixture.state).toEqual(publicationState)
    expect(next.fixture.hub).toEqual(publicationHub)
    expect(next.fixture.state.stats.branch).toBe("prototype/welcome")
    expect(next.fixture.hub.hubOrigin).toBe("https://hub.example.com")
  })

  it("returns prototype state and Hub status only for their own read endpoints", async () => {
    const { fetch } = sharingFixture(publicationState, publicationHub)
    const state = await fetch("/api/state")
    const hub = await fetch("/api/hub/status")
    expect(await state.json()).toEqual(publicationState)
    expect(await hub.json()).toEqual(publicationHub)
  })

  it.fails("fails an unexpected request even when its rejection is handled", async () => {
    const { fetch } = sharingFixture()
    await expect(fetch("/api/unexpected")).rejects.toThrow(
      "Unexpected canvas request: /api/unexpected",
    )
  })
})
