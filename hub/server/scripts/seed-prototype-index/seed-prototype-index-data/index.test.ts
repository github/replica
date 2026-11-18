import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import { validateControlsDocument } from "../../../../client/utils/prototype-controls/controls.mjs"

import { seededBuildArtifactBytes, seededBuildArtifacts } from "."

function pngImageData(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes)
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const chunks: Buffer[] = []
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString("ascii", offset + 4, offset + 8)
    if (type === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 12 + length
  }
  return inflateSync(Buffer.concat(chunks))
}

describe("seeded Build artifacts", () => {
  it("uses a valid page-scoped Controls declaration", () => {
    const artifact = seededBuildArtifacts.find(({ path }) => path === "dist/controls.replica.json")
    if (!artifact) throw new Error("Missing seeded Controls artifact.")

    expect(() =>
      validateControlsDocument(
        JSON.parse(
          Buffer.from(seededBuildArtifactBytes.get(artifact.storageKey)!).toString("utf8"),
        ),
      ),
    ).not.toThrow()
    expect(artifact.storageKey).toBe("seed_navigation_controls_v2")
  })

  it("uses decodable rotated screenshot artifacts", () => {
    for (const path of ["screenshots/desktop.png", "screenshots/narrow.png"]) {
      const artifact = seededBuildArtifacts.find((entry) => entry.path === path)
      if (!artifact) throw new Error(`Missing ${path}.`)
      expect(pngImageData(seededBuildArtifactBytes.get(artifact.storageKey)!)).toHaveLength(5)
      expect(artifact.storageKey).toMatch(/_v2$/)
    }
  })
})
