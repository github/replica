import { randomBytes } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import type { ArtifactStorage } from "../../../domains/artifacts/create-artifact-storage/types"
import { createBuildPreviewRouteDependencies } from "."

vi.mock("../../../integrations/prisma/index.ts", () => ({ prisma: {} }))

const storage = {} as ArtifactStorage
const encryptionKey = randomBytes(32).toString("base64")

describe("createBuildPreviewRouteDependencies()", () => {
  it("enables canonical private serving with storage and no wildcard origin", () => {
    const preview = createBuildPreviewRouteDependencies(
      {
        HUB_APPLICATION_ORIGIN: "https://hub.example.com",
        HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
      },
      storage,
    )
    expect(preview.previewBaseOrigin).toBeUndefined()
    expect(typeof preview.findPathTargets).toBe("function")
    expect(preview.storage).toBe(storage)
  })

  it("requires previews to use a separate registrable domain outside local development", () => {
    expect(() =>
      createBuildPreviewRouteDependencies(
        {
          HUB_APPLICATION_ORIGIN: "https://hub.example.com",
          HUB_PREVIEW_ORIGIN: "https://build.preview.example.com",
          HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        },
        storage,
      ),
    ).toThrow("HUB_PREVIEW_ORIGIN must use a separate registrable domain")

    expect(() =>
      createBuildPreviewRouteDependencies(
        {
          HUB_APPLICATION_ORIGIN: "https://hub.example.com",
          HUB_PREVIEW_ORIGIN: "https://build.preview.example.net",
          HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        },
        storage,
      ),
    ).not.toThrow()
  })

  it("keeps wildcard localhost previews available for local Hub development", () => {
    expect(() =>
      createBuildPreviewRouteDependencies(
        {
          HUB_APPLICATION_ORIGIN: "http://localhost:5173",
          HUB_PREVIEW_ORIGIN: "http://preview.localhost:3001",
          HUB_AUTHENTICATION_ENCRYPTION_KEY: encryptionKey,
        },
        storage,
      ),
    ).not.toThrow()
  })
})
