import { describe, expect, it, vi } from "vitest"

describe("local API startup", () => {
  it("enables local mode and local sign-in before starting the API", async () => {
    vi.resetModules()
    vi.stubEnv("HUB_LOCAL_MODE", "false")
    vi.stubEnv("HUB_LOCAL_SIGN_IN", "false")
    vi.stubEnv("ARTIFACT_STORAGE_PROVIDER", undefined)
    vi.stubEnv("ARTIFACT_STORAGE_DIRECTORY", undefined)
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
        provider: process.env.ARTIFACT_STORAGE_PROVIDER,
      })
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith({
      localMode: "true",
      localSignIn: "true",
      provider: process.platform === "linux" ? "filesystem" : undefined,
    })
  })

  it("does not mix filesystem defaults into an explicit Azure provider", async () => {
    vi.resetModules()
    vi.stubEnv("ARTIFACT_STORAGE_PROVIDER", "azure")
    vi.stubEnv("ARTIFACT_STORAGE_DIRECTORY", undefined)
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start({
        provider: process.env.ARTIFACT_STORAGE_PROVIDER,
        directory: process.env.ARTIFACT_STORAGE_DIRECTORY,
      })
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith({
      provider: "azure",
      directory: undefined,
    })
  })

  it("derives the preview origin from a custom API port", async () => {
    vi.resetModules()
    vi.stubEnv("PORT", "4101")
    vi.stubEnv("HUB_PREVIEW_ORIGIN", undefined)
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start({ previewOrigin: process.env.HUB_PREVIEW_ORIGIN })
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith({
      previewOrigin: "http://preview.localhost:4101",
    })
  })
})
