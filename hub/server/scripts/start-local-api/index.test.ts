import { describe, expect, it, vi } from "vitest"

describe("local API startup", () => {
  it("enables local mode and local sign-in before starting the API", async () => {
    vi.resetModules()
    vi.stubEnv("HUB_LOCAL_MODE", "false")
    vi.stubEnv("HUB_LOCAL_SIGN_IN", "false")
    vi.doMock("dotenv/config", () => {
      process.env.HUB_LOCAL_MODE = "false"
      process.env.HUB_LOCAL_SIGN_IN = "false"
      return {}
    })
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start({
        localMode: process.env.HUB_LOCAL_MODE,
        localSignIn: process.env.HUB_LOCAL_SIGN_IN,
      })
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith({
      localMode: "true",
      localSignIn: "true",
    })
  })
})
