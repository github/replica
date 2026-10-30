import { describe, expect, it, vi } from "vitest"

import { request } from "."

describe("request()", () => {
  it("sends the canvas token and returns a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ name: "Demo" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(request<{ name: string }>("/api/state", "local-token")).resolves.toEqual({
      name: "Demo",
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/state", {
      headers: {
        "Content-Type": "application/json",
        "X-Replica-Canvas-Token": "local-token",
      },
    })
  })

  it("reports the extension error without turning it into a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid canvas request token." }),
      }),
    )

    await expect(request("/api/refresh", "expired", { method: "POST" })).rejects.toThrow(
      "Invalid canvas request token.",
    )
  })
  it("preserves sharing error codes and status for explicit recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({ error: "Delivery unknown.", code: "share_delivery_unknown" }),
      }),
    )
    await expect(
      request("/api/hub/share-links/create", "local", { method: "POST" }),
    ).rejects.toMatchObject({
      message: "Delivery unknown.",
      code: "share_delivery_unknown",
      statusCode: 502,
    })
  })
})
