import { describe, expect, it, vi } from "vitest"

import { createGitHubSetupRouteDependencies } from "."

vi.mock("../../../../../integrations/prisma/index.ts", () => ({ prisma: {} }))

const shared = {
  HUB_APPLICATION_ORIGIN: "https://hub.example.test",
  HUB_AUTHENTICATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  HUB_BOOTSTRAP_SECRET: "bootstrap-secret-that-is-at-least-32-characters",
}

describe("createGitHubSetupRouteDependencies()", () => {
  it("reports incomplete settings without enabling sign-in or connection tests", async () => {
    const dependencies = createGitHubSetupRouteDependencies({
      ...shared,
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
      GITHUB_PROVIDER_REVISION: "1",
      GITHUB_APP_ID: "invalid",
    })

    const status = await dependencies.readStatus()
    expect(status).toMatchObject({
      status: "incomplete",
      signInEnabled: false,
    })
    expect(status.settings).toEqual(
      expect.arrayContaining([
        { key: "GITHUB_APP_ID", state: "invalid" },
        { key: "GITHUB_APP_INSTALLATION_ID", state: "missing" },
      ]),
    )
    await expect(dependencies.testConnection()).resolves.toBeNull()
  })

  it("rejects an invalid shared configuration before making setup available", () => {
    expect(() =>
      createGitHubSetupRouteDependencies({
        ...shared,
        HUB_APPLICATION_ORIGIN: "http://example.test",
      }),
    ).toThrow("HUB_APPLICATION_ORIGIN must use HTTPS")
  })
})
