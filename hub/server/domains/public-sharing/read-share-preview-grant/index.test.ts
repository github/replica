import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

import { createSharePreviewGrant } from "../create-share-preview-grant"
import { createSharePreviewSession } from "../create-share-preview-session"
import { readSharePreviewSession } from "../read-share-preview-session"
import { readSharePreviewGrant } from "."

describe("readSharePreviewGrant()", () => {
  it("does not interchange public preview grants and sessions", () => {
    const key = Buffer.alloc(32, 1)
    const buildId = randomUUID()
    const shareLinkId = randomUUID()
    const now = new Date("2026-11-18T18:00:00.000Z")
    const expiresAt = new Date(now.getTime() + 60_000)
    const input = { buildId, shareLinkId, expiresAt }
    const grant = createSharePreviewGrant(input, key)
    const session = createSharePreviewSession(input, key)

    expect(readSharePreviewGrant(grant, key, now)).toMatchObject({
      p: "grant",
      b: buildId,
      s: shareLinkId,
    })
    expect(readSharePreviewSession(session, buildId, key, now)).toMatchObject({
      p: "session",
      b: buildId,
      s: shareLinkId,
    })
    expect(readSharePreviewGrant(session, key, now)).toBeNull()
    expect(readSharePreviewSession(grant, buildId, key, now)).toBeNull()
  })
})
