import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { readPreviewBuildId } from "."

describe("readPreviewBuildId()", () => {
  it("extracts a Build ID from a plain preview host value", () => {
    const buildId = randomUUID()

    expect(
      readPreviewBuildId(`${buildId}.preview.localhost:3001`, "http://preview.localhost:3001"),
    ).toBe(buildId)
  })

  it("rejects another port or hostname", () => {
    const buildId = randomUUID()

    expect(
      readPreviewBuildId(`${buildId}.preview.localhost:4001`, "http://preview.localhost:3001"),
    ).toBeNull()
    expect(
      readPreviewBuildId(`${buildId}.untrusted.example:3001`, "http://preview.localhost:3001"),
    ).toBeNull()
  })
})
