import { randomBytes, randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createPreviewSession } from "../create-preview-session"
import { readPreviewSession } from "."

describe("readPreviewSession()", () => {
  it("accepts an unexpired session only on its Build origin", () => {
    const key = randomBytes(32)
    const buildId = randomUUID()
    const now = new Date("2026-11-16T22:00:00.000Z")
    const session = createPreviewSession(
      buildId,
      "a".repeat(64),
      new Date(now.getTime() + 1_000),
      key,
    )

    expect(readPreviewSession(session, buildId, key, now)).toMatchObject({ b: buildId })
    expect(readPreviewSession(session, randomUUID(), key, now)).toBeNull()
  })

  it("rejects a session at and after its expiry", () => {
    const key = randomBytes(32)
    const buildId = randomUUID()
    const expiresAt = new Date("2026-11-16T22:00:00.000Z")
    const session = createPreviewSession(buildId, "a".repeat(64), expiresAt, key)

    expect(readPreviewSession(session, buildId, key, expiresAt)).toBeNull()
  })
})
