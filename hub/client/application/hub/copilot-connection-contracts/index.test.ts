import { describe, expect, it } from "vitest"

import { copilotConnectionStatusSchema } from "."

describe("copilotConnectionStatusSchema", () => {
  it("keeps saved connection presence separate from active connected state", () => {
    expect(
      copilotConnectionStatusSchema.parse({
        configured: true,
        connected: false,
        savedConnection: true,
        connectedBy: null,
        refusedAt: "2026-11-11T13:00:00.000Z",
        verifiedAt: null,
      }),
    ).toEqual({
      configured: true,
      connected: false,
      savedConnection: true,
      connectedBy: null,
      refusedAt: "2026-11-11T13:00:00.000Z",
      verifiedAt: null,
    })
  })

  it("requires the saved connection field instead of inferring it from connected", () => {
    expect(
      copilotConnectionStatusSchema.safeParse({
        configured: true,
        connected: false,
        connectedBy: null,
        refusedAt: null,
        verifiedAt: null,
      }).success,
    ).toBe(false)
  })
})
