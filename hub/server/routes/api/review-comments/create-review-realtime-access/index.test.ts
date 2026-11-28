import { createHash, randomUUID } from "node:crypto"
import { IncomingMessage } from "node:http"
import { Socket } from "node:net"
import { describe, expect, it, vi } from "vitest"

import type { ProductRouteDependencies } from "../../product/types"

import { createReviewRealtimeAccess } from "."

describe("createReviewRealtimeAccess()", () => {
  it.each([
    {
      applicationOrigin: "http://127.0.0.1:5173",
      secureCookie: false,
      expectedValue: "legacy-session",
    },
    {
      applicationOrigin: "https://hub.example.test",
      secureCookie: true,
      expectedValue: "protected-session",
    },
  ])(
    "uses the configured authentication scheme at $applicationOrigin",
    async ({ applicationOrigin, secureCookie, expectedValue }) => {
      const restore = vi.fn().mockResolvedValue({
        membershipId: randomUUID(),
        userId: randomUUID(),
        provider: "github",
        sessionProvider: "github",
        login: "member",
        name: null,
        role: "MEMBER",
      })
      const access = createReviewRealtimeAccess(
        {
          currentSession: { restore },
          signOut: { applicationOrigin, secureCookie, end: vi.fn() },
        },
        {} as ProductRouteDependencies,
      )
      const request = new IncomingMessage(new Socket())
      request.headers = {
        origin: applicationOrigin,
        cookie: "hub_session=legacy-session; __Host-hub_session=protected-session",
      }
      const digest = createHash("sha256").update(expectedValue).digest("hex")

      expect(await access.authenticate?.(request, new AbortController().signal)).toBe(digest)
      expect(restore).toHaveBeenCalledExactlyOnceWith(digest)
    },
  )

  it("ignores a legacy-only session cookie while the private reader shares Hub's site", async () => {
    const applicationOrigin = "https://hub.example.test"
    const restore = vi.fn()
    const access = createReviewRealtimeAccess(
      {
        currentSession: { restore },
        signOut: { applicationOrigin, secureCookie: true, end: vi.fn() },
      },
      {} as ProductRouteDependencies,
      { protectedSessionOnly: true },
    )
    const request = new IncomingMessage(new Socket())
    request.headers = { origin: applicationOrigin, cookie: "hub_session=legacy-session" }

    expect(await access.authenticate?.(request, new AbortController().signal)).toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })
})
