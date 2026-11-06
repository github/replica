import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { orderedScenes, verifySources } from "./catalog.ts"

describe("wizard design catalog", () => {
  it("keeps all 100 synthetic scenes individually identified and annotated", () => {
    const scenes = orderedScenes()

    expect(scenes).toHaveLength(100)
    expect(new Set(scenes.map(scene => scene.id)).size).toBe(100)
    for (const scene of scenes) {
      expect(scene.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
      expect(scene.id).not.toMatch(/(?:^|-)\d{3}(?:-|$)/)
      for (const key of ["title", "source", "purpose", "decision", "consequence"] as const) {
        expect(scene[key].trim(), `${scene.id}: ${key}`).not.toBe("")
      }
    }
  })

  it("places the two recovery variants before shell output without historic numbering gaps", () => {
    const scenes = orderedScenes()

    expect(scenes.slice(80, 84).map(scene => scene.id)).toEqual([
      "lock-cleared-and-setup-continues",
      "unverified-or-unrelated-app-prevents-shutdown",
      "clearing-approval-before-app-resources-exist",
      "cli-help-and-automation-entry",
    ])
    expect(scenes.map(scene => scene.ordinal)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    )
    expect(scenes.map(scene => scene.label)).toEqual(
      scenes.map((scene, index) => `${String(index + 1).padStart(3, "0")} · ${scene.title}`),
    )
  })

  it("derives display numbers from a reordered catalog without renaming or mutating scenes", () => {
    const [first, second] = orderedScenes()
    const catalog = Object.freeze([
      Object.freeze({ ...second, ordinal: 99, label: "099 · Old label" }),
      Object.freeze({ ...first, ordinal: 81, label: "081 · Old label" }),
    ])

    const reordered = orderedScenes(catalog)

    expect(reordered.map(({ id, ordinal, label }) => ({ id, ordinal, label }))).toEqual([
      { id: second.id, ordinal: 1, label: `001 · ${second.title}` },
      { id: first.id, ordinal: 2, label: `002 · ${first.title}` },
    ])
    expect(catalog.map(scene => scene.ordinal)).toEqual([99, 81])
  })

  it("verifies the committed source bindings without reading operator configuration", async () => {
    const repository = fileURLToPath(new URL("../../../", import.meta.url))

    await expect(verifySources(repository)).resolves.toBeUndefined()
  })
})
