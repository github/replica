import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

describe("prototype index seed", () => {
  it("seeds the selected local member and closes the database connection", async () => {
    const userId = "00000000-0000-4000-8000-000000000001"
    const prisma = { $disconnect: vi.fn() }
    const seed = vi.fn()
    const originalArgv = process.argv

    try {
      process.argv = [process.execPath, "seed-prototype-index", userId]
      vi.stubEnv("NODE_ENV", "development")
      vi.stubEnv("DATABASE_URL", "postgresql://replica:replica@127.0.0.1:5432/replica")
      vi.stubEnv("DOTENV_CONFIG_OVERRIDE", "false")
      vi.doMock("../../integrations/prisma/index.ts", () => ({ prisma }))
      vi.doMock("./seed-prototype-index-data/index.ts", () => ({ seedPrototypeIndexData: seed }))
      vi.spyOn(console, "log").mockImplementation(() => {})

      await import(".")

      expect(seed).toHaveBeenCalledExactlyOnceWith(prisma, userId)
      expect(prisma.$disconnect).toHaveBeenCalledOnce()
    } finally {
      process.argv = originalArgv
      vi.doUnmock("../../integrations/prisma/index.ts")
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
