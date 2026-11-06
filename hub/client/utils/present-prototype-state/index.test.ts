import { describe, expect, it } from "vitest"

import { resolvePublication } from "../resolve-prototype-publication"
import {
  importedPrototype,
  publicationHub,
  publicationState,
} from "../resolve-prototype-publication/fixtures"
import { presentPrototypeState } from "."

describe("presentPrototypeState()", () => {
  it("presents a matching imported Build without mutating local state", () => {
    const hub = { ...publicationHub, state: "connected" as const, prototype: importedPrototype }
    const presented = presentPrototypeState(
      publicationState,
      hub,
      resolvePublication(publicationState, hub),
    )
    expect(presented.hubPublished).toBe(true)
    expect(presented.state?.publishStatus).toMatchObject({
      state: "published",
      versionCount: 1,
      run: { url: importedPrototype.build?.url, actor: { login: "octocat" } },
    })
    expect(presented.state?.stats.publishedUrl).toBe(importedPrototype.build?.url)
    expect(publicationState.publishStatus).toBeUndefined()
    expect(publicationState.stats.publishedUrl).toBeUndefined()
  })

  it("withholds a stale comparison while keeping the local commit", () => {
    const hub = { ...publicationHub, commitSha: "b".repeat(40) }
    const presented = presentPrototypeState(
      publicationState,
      hub,
      resolvePublication(publicationState, hub),
    )
    expect(presented.comparisonOutdated).toBe(true)
    expect(presented.state?.stats.commitSha).toBe(publicationState.stats.commitSha)
    expect(presented.state?.stats.comparison).toEqual({
      branch: null,
      source: null,
      behind: null,
      error: "Branch comparison unavailable until Git stats refresh.",
    })
  })

  it("keeps a detached checkout error instead of adopting a cached Hub branch", () => {
    const state = {
      ...publicationState,
      stats: { ...publicationState.stats, branch: undefined, branchError: "Detached checkout" },
    }
    const presented = presentPrototypeState(
      state,
      publicationHub,
      resolvePublication(state, publicationHub),
    )
    expect(presented.state?.stats.branch).toBeUndefined()
    expect(presented.state?.stats.branchError).toBe("Detached checkout")
    expect(presented.comparisonOutdated).toBe(false)
  })
})
