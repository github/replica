import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

const { createLocalArtifactStorage } = vi.hoisted(() => ({
  createLocalArtifactStorage: vi.fn((root: string) => {
    void root
    return {
      put: vi.fn(),
      read: vi.fn(),
      remove: vi.fn(),
    }
  }),
}))

vi.mock("#server/integrations/artifact-storage/create-local-storage", () => ({
  createLocalArtifactStorage,
}))
vi.mock("#server/integrations/prisma", () => ({ prisma: {} }))

import { createAuthenticationRuntime } from "#server/domains/authentication/create-runtime"

describe("createAuthenticationRuntime()", () => {
  it("keeps default artifact storage outside the checkout", async () => {
    await createAuthenticationRuntime({ HUB_AUTH_PROVIDER: "github" })

    expect(createLocalArtifactStorage).toHaveBeenCalledWith(
      path.join(os.homedir(), ".replica", "artifacts"),
    )
    const storagePath = createLocalArtifactStorage.mock.calls[0]?.[0]
    expect(storagePath).toBeTypeOf("string")
    if (!storagePath) throw new Error("Expected an artifact storage path")
    expect(path.relative(process.cwd(), storagePath)).toMatch(/^\.\./)
  })
})
