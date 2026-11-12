import { describe, expect, it, vi } from "vitest"

describe("local API startup", () => {
  it("enables local sign-in before starting the API", async () => {
    vi.resetModules()
    vi.stubEnv("HUB_LOCAL_SIGN_IN", "false")
    vi.doMock("dotenv/config", () => {
      process.env.HUB_LOCAL_SIGN_IN = "false"
      return {}
    })
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start(process.env.HUB_LOCAL_SIGN_IN)
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith("true")
  })
})
