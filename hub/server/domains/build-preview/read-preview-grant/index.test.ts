import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createPreviewGrant } from "../create-preview-grant"
import { readPreviewGrant } from "."

describe("readPreviewGrant()", () => {
  it("accepts a short-lived grant with its Build and target", () => {
    const key = randomBytes(32)
    const buildId = randomUUID()
    const now = new Date("2026-11-16T22:00:00.000Z")
    const expiresAt = new Date(now.getTime() + 30_000)

    expect(
      readPreviewGrant(
        createPreviewGrant({ buildId, target: "desktop", expiresAt }, key),
        key,
        now,
      ),
    ).toEqual({ buildId, target: "desktop", expiresAt })
  })

  it("rejects expired grants and grants whose lifetime exceeds one minute", () => {
    const key = randomBytes(32)
    const buildId = randomUUID()
    const now = new Date("2026-11-16T22:00:00.000Z")

    for (const expiresAt of [new Date(now.getTime()), new Date(now.getTime() + 60_001)]) {
      const grant = createPreviewGrant({ buildId, target: "preview", expiresAt }, key)
      expect(readPreviewGrant(grant, key, now)).toBeNull()
    }
  })
})
