import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

describe("prototype index seed", () => {
  it("seeds the selected local member and closes the database connection", async () => {
    const userId = "00000000-0000-4000-8000-000000000001"
    const prisma = { $disconnect: vi.fn() }
    const seed = vi.fn()
    const write = vi.fn().mockResolvedValue({ status: "ok" })
    const originalArgv = process.argv

    try {
      process.argv = [process.execPath, "seed-prototype-index", userId]
      vi.stubEnv("NODE_ENV", "development")
      vi.stubEnv("DATABASE_URL", "postgresql://replica:replica@127.0.0.1:5432/replica")
      vi.stubEnv("ARTIFACT_STORAGE_PROVIDER", "filesystem")
      vi.stubEnv("DOTENV_CONFIG_OVERRIDE", "false")
      vi.doMock("node:fs/promises", () => ({ mkdir: vi.fn() }))
      vi.doMock("../../integrations/prisma/index.ts", () => ({ prisma }))
      vi.doMock("../../domains/artifacts/create-configured-artifact-storage/index.ts", () => ({
        createConfiguredArtifactStorage: vi.fn().mockResolvedValue({ write }),
      }))
      vi.doMock("./seed-prototype-index-data/index.ts", () => ({
        seedPrototypeIndexData: seed,
        seededBuildArtifactBytes: new Map([["seed-key", new Uint8Array([1])]]),
        seededBuildArtifacts: [{ path: "dist/index.html", storageKey: "seed-key" }],
      }))
      vi.spyOn(console, "log").mockImplementation(() => {})

      await import(".")

      expect(seed).toHaveBeenCalledExactlyOnceWith(prisma, userId, true)
      expect(write).toHaveBeenCalledExactlyOnceWith("seed-key", new Uint8Array([1]))
      expect(prisma.$disconnect).toHaveBeenCalledOnce()
    } finally {
      process.argv = originalArgv
      vi.doUnmock("../../integrations/prisma/index.ts")
      vi.doUnmock("node:fs/promises")
      vi.doUnmock("../../domains/artifacts/create-configured-artifact-storage/index.ts")
      vi.doUnmock("./seed-prototype-index-data/index.ts")
    }
  })

  it("keeps database-only seeding available without artifact storage", async () => {
    vi.resetModules()
    const userId = "00000000-0000-4000-8000-000000000001"
    const prisma = { $disconnect: vi.fn() }
    const seed = vi.fn()
    const createStorage = vi.fn()
    const originalArgv = process.argv

    try {
      process.argv = [process.execPath, "seed-prototype-index", userId]
      vi.stubEnv("NODE_ENV", "development")
      vi.stubEnv("DATABASE_URL", "postgresql://replica:replica@127.0.0.1:5432/replica")
      vi.stubEnv("ARTIFACT_STORAGE_PROVIDER", undefined)
      vi.stubEnv("ARTIFACT_STORAGE_DIRECTORY", undefined)
      vi.stubEnv("DOTENV_CONFIG_OVERRIDE", "false")
      vi.doMock("../../integrations/prisma/index.ts", () => ({ prisma }))
      vi.doMock("../../domains/artifacts/create-configured-artifact-storage/index.ts", () => ({
        createConfiguredArtifactStorage: createStorage,
      }))
      vi.doMock("./seed-prototype-index-data/index.ts", () => ({
        seedPrototypeIndexData: seed,
        seededBuildArtifactBytes: new Map(),
        seededBuildArtifacts: [],
      }))
      vi.spyOn(console, "log").mockImplementation(() => {})

      await import(".")

      expect(createStorage).not.toHaveBeenCalled()
      expect(seed).toHaveBeenCalledExactlyOnceWith(prisma, userId, false)
      expect(prisma.$disconnect).toHaveBeenCalledOnce()
    } finally {
      process.argv = originalArgv
      vi.doUnmock("../../integrations/prisma/index.ts")
      vi.doUnmock("../../domains/artifacts/create-configured-artifact-storage/index.ts")
      vi.doUnmock("./seed-prototype-index-data/index.ts")
    }
  })

  it("rejects unsafe configuration before initializing Prisma", () => {
    const script = fileURLToPath(new URL("./index.ts", import.meta.url))
    const result = spawnSync(process.execPath, [script, "00000000-0000-4000-8000-000000000001"], {
      env: {
        NODE_ENV: "production",
        DATABASE_URL: "",
        DOTENV_CONFIG_OVERRIDE: "false",
      },
      encoding: "utf8",
      timeout: 10_000,
    })

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("The prototype seed requires a local development database.")
    expect(result.stderr).not.toContain("Set DATABASE_URL before importing the Prisma client.")
  }, 15_000)
})
