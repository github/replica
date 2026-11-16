import { describe, expect, it, vi } from "vitest"

describe("local on-demand worker startup", () => {
  it("selects the supported worker runtime with local mode enabled", async () => {
    vi.resetModules()
    vi.stubEnv("HUB_LOCAL_MODE", "false")
    vi.stubEnv("RUNTIME_MODE", "scheduled")
    vi.doMock("dotenv/config", () => {
      process.env.HUB_LOCAL_MODE = "false"
      process.env.RUNTIME_MODE = "scheduled"
      return {}
    })
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start({
        localMode: process.env.HUB_LOCAL_MODE,
        runtimeMode: process.env.RUNTIME_MODE,
      })
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith({
      localMode: "true",
      runtimeMode: "on-demand",
    })
  })
})
