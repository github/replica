import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

const { createLocalArtifactStorage, ensureOidcProviderRevision } = vi.hoisted(() => ({
  createLocalArtifactStorage: vi.fn((root: string) => {
    if (!path.isAbsolute(root)) {
      throw new Error("HUB_ARTIFACT_STORAGE_PATH must be an absolute path.")
    }
    return {
      put: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    }
  }),
  ensureOidcProviderRevision: vi.fn(),
}))

vi.mock("#server/integrations/artifact-storage/create-local-storage", () => ({
  createLocalArtifactStorage,
}))
vi.mock("#server/domains/authentication/ensure-oidc-provider-revision", () => ({
  ensureOidcProviderRevision,
}))
vi.mock("#server/integrations/prisma", () => ({ prisma: {} }))

import { createAuthenticationRuntime } from "#server/domains/authentication/create-runtime"

function oidcEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HUB_AUTH_PROVIDER: "oidc",
    HUB_OIDC_ENABLED: "true",
    HUB_OIDC_ISSUER: "https://login.microsoftonline.com/a0b1c2d3-e4f5-4a67-8b9c-0d1e2f3a4b5c/v2.0",
    HUB_OIDC_CLIENT_ID: "hub-client",
    HUB_OIDC_CLIENT_CREDENTIAL_REFERENCE: "HUB_OIDC_CLIENT_SECRET",
    HUB_OIDC_CLIENT_SECRET: "client-secret-fixture",
    HUB_OIDC_CALLBACK_URL: "http://127.0.0.1:5173/api/auth/oidc/callback",
    HUB_OIDC_SCOPES: "openid profile email",
    HUB_OIDC_MEMBER_ROLE: "Hub.User",
    HUB_OIDC_ADMINISTRATOR_ROLE: "Hub.Administrator",
    HUB_OIDC_MEMBERSHIP_POLICY: "invitation-required",
    HUB_OIDC_PROVIDER_REVISION: "5",
    ...overrides,
  }
}

describe("createAuthenticationRuntime()", () => {
  it.each([undefined, "", " \t "])(
    "keeps unset artifact storage outside the checkout for %j",
    async (configuredPath) => {
      await createAuthenticationRuntime({
        HUB_AUTH_PROVIDER: "github",
        ...(configuredPath === undefined ? {} : { HUB_ARTIFACT_STORAGE_PATH: configuredPath }),
      })

      expect(createLocalArtifactStorage).toHaveBeenCalledWith(
        path.join(os.homedir(), ".replica", "artifacts"),
      )
      const storagePath = createLocalArtifactStorage.mock.calls[0]?.[0]
      expect(storagePath).toBeTypeOf("string")
      if (!storagePath) throw new Error("Expected an artifact storage path")
      expect(path.relative(process.cwd(), storagePath)).toMatch(/^\.\./)
    },
  )

  it("passes a configured relative storage path unchanged to the storage adapter", async () => {
    await expect(
      createAuthenticationRuntime({
        HUB_AUTH_PROVIDER: "github",
        HUB_ARTIFACT_STORAGE_PATH: "relative/artifacts",
      }),
    ).rejects.toThrow("HUB_ARTIFACT_STORAGE_PATH must be an absolute path.")

    expect(createLocalArtifactStorage).toHaveBeenCalledWith("relative/artifacts")
  })

  it("rejects an incompatible OIDC admission policy before persisting a provider revision", async () => {
    await expect(
      createAuthenticationRuntime({
        HUB_AUTH_PROVIDER: "oidc",
        HUB_ADMISSION_POLICY: "github-synchronized",
      }),
    ).rejects.toThrow("OIDC authentication requires HUB_ADMISSION_POLICY=hub-managed.")

    expect(ensureOidcProviderRevision).not.toHaveBeenCalled()
  })

  it("rejects invalid host secrets before persisting a replacement OIDC provider revision", async () => {
    const sharedSecret = "shared-host-secret-fixture-value"

    await expect(
      createAuthenticationRuntime(
        oidcEnvironment({
          HUB_BOOTSTRAP_SECRET: sharedSecret,
          HUB_ADMIN_RECOVERY_SECRET: sharedSecret,
        }),
      ),
    ).rejects.toThrow("HUB_BOOTSTRAP_SECRET and HUB_ADMIN_RECOVERY_SECRET must be different.")

    expect(ensureOidcProviderRevision).not.toHaveBeenCalled()
  })
})
