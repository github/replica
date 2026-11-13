import { describe, expect, it, vi } from "vitest"

const providerSettings = [
  "GITHUB_APP_ID",
  "GITHUB_APP_INSTALLATION_ID",
  "GITHUB_APP_PRIVATE_KEY_BASE64",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_PROVIDER_REVISION",
  "GITHUB_WEBHOOK_SECRET",
  "ENTRA_OIDC_CLIENT_AUTHENTICATION",
  "ENTRA_OIDC_CLIENT_ID",
  "ENTRA_OIDC_CLIENT_SECRET",
  "ENTRA_OIDC_ISSUER",
  "ENTRA_OIDC_MANAGED_IDENTITY_CLIENT_ID",
  "ENTRA_OIDC_PROVIDER_REVISION",
]

describe("live API startup", () => {
  it("requires an origin or provider settings before starting the API", async () => {
    vi.resetModules()
    for (const setting of providerSettings) vi.stubEnv(setting, "")
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "")
    vi.stubEnv("HUB_LOCAL_SIGN_IN", "true")
    vi.doMock("dotenv/config", () => ({}))
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start()
      return {}
    })

    await expect(import(".")).rejects.toThrow(
      "Set HUB_APPLICATION_ORIGIN to use GitHub setup, or configure GitHub or Entra sign-in, before running npm run dev:api:live.",
    )
    expect(start).not.toHaveBeenCalled()
  })

  it("starts for GitHub setup before any provider is configured", async () => {
    vi.resetModules()
    for (const setting of providerSettings) vi.stubEnv(setting, "")
    vi.stubEnv("HUB_APPLICATION_ORIGIN", "http://127.0.0.1:5173")
    vi.doMock("dotenv/config", () => ({}))
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start()
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledOnce()
  })

  it("disables local sign-in before starting the configured API", async () => {
    vi.resetModules()
    for (const setting of providerSettings) vi.stubEnv(setting, "")
    vi.stubEnv("HUB_LOCAL_SIGN_IN", "true")
    vi.doMock("dotenv/config", () => {
      process.env.GITHUB_CLIENT_ID = "github-client"
      process.env.HUB_LOCAL_SIGN_IN = "true"
      return {}
    })
    const start = vi.fn()
    vi.doMock("../../index.ts", () => {
      start(process.env.HUB_LOCAL_SIGN_IN)
      return {}
    })

    await import(".")

    expect(start).toHaveBeenCalledExactlyOnceWith("false")
  })
})
