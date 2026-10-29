import { describe, expect, it, onTestFinished, vi } from "vitest"

describe("createAuthenticationRuntime()", () => {
  it.each([
    {
      name: "trusted proxy setting",
      environment: { HUB_TRUSTED_PROXY_HOPS: "invalid" },
      message: "HUB_TRUSTED_PROXY_HOPS",
    },
    {
      name: "admission policy",
      environment: { HUB_ADMISSION_POLICY: "invalid" },
      message: "HUB_ADMISSION_POLICY",
    },
    {
      name: "legacy admission credentials",
      environment: { HUB_ADMISSION_POLICY: "legacy-repository" },
      message: "HUB_GITHUB_CREDENTIAL_KEY",
    },
  ])(
    "validates the $name before creating a provider revision",
    async ({ environment, message }) => {
      vi.stubGlobal("prisma", undefined)
      const { prisma } = await import("../../../integrations/prisma")
      const { createAuthenticationRuntime } = await import(".")
      onTestFinished(() => prisma.$disconnect())

      await expect(
        createAuthenticationRuntime({
          HUB_ORIGIN: "https://hub.example",
          HUB_GITHUB_AUTH_CLIENT_ID: "github-client",
          HUB_GITHUB_AUTH_CLIENT_SECRET: "github-client-secret-fixture",
          ...environment,
        }),
      ).rejects.toThrow(message)

      await expect(prisma.authenticationProvider.count()).resolves.toBe(0)
    },
  )
})
