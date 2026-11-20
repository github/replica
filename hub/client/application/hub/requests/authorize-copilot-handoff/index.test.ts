import { describe, expect, it, vi } from "vitest"

import { authorizeCopilotHandoff } from "."

describe("authorizeCopilotHandoff()", () => {
  it("allows explicit copy fallback only for callers that opt in", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        Response.json({ error: "GitHub unavailable", canCopy: true }, { status: 503 }),
      ),
    )
    vi.stubGlobal("fetch", fetch)

    await expect(authorizeCopilotHandoff("2001", { allowCopyFallback: true })).resolves.toBe("copy")
    await expect(authorizeCopilotHandoff("2001")).rejects.toMatchObject({ status: 503 })
  })

  it.each([undefined, true])(
    "denies a hidden repository even when copy fallback is %s",
    async (allowCopyFallback) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json({ error: "Repository not found", canCopy: true }, { status: 404 }),
          ),
      )

      await expect(authorizeCopilotHandoff("2001", { allowCopyFallback })).resolves.toBe(false)
    },
  )

  it.each([
    { status: 401, canCopy: true },
    { status: 503, canCopy: undefined },
    { status: 503, canCopy: false },
  ])("rejects a $status with no applicable copy authorization", async ({ status, canCopy }) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: "Access unavailable", canCopy }, { status })),
    )

    await expect(
      authorizeCopilotHandoff("2001", { allowCopyFallback: true }),
    ).rejects.toMatchObject({ status })
  })

  it("does not allow copy when the request cannot reach Hub", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network unavailable")))

    await expect(
      authorizeCopilotHandoff("2001", { allowCopyFallback: true }),
    ).rejects.toMatchObject({ status: 0 })
  })
})
