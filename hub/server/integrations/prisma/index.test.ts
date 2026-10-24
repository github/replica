import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../../generated/prisma/client"

vi.mock("dotenv/config", () => ({}))

describe("prisma", () => {
  it("reuses the development client after a module reload", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DATABASE_URL", "postgresql://replica:replica@127.0.0.1:5432/replica_test")
    vi.stubGlobal("prisma", undefined)

    const { prisma } = await import(".")
    let reloaded: PrismaClient | undefined

    try {
      vi.resetModules()
      reloaded = (await import(".")).prisma

      expect(reloaded).toBe(prisma)
    } finally {
      await prisma.$disconnect()
      if (reloaded !== prisma) await reloaded?.$disconnect()
    }
  })

  it("keeps one production client without writing a development global", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("DATABASE_URL", "postgresql://replica:replica@127.0.0.1:5432/replica_test")
    vi.stubGlobal("prisma", undefined)

    const { prisma } = await import(".")

    try {
      expect((await import(".")).prisma).toBe(prisma)
      expect(Reflect.get(globalThis, "prisma")).toBeUndefined()
    } finally {
      await prisma.$disconnect()
    }
  })

  it("rejects a missing database URL instead of using a local database", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("DATABASE_URL", undefined)
    vi.stubGlobal("prisma", undefined)
    let prisma: PrismaClient | undefined

    try {
      await expect(
        import(".").then((module) => {
          prisma = module.prisma
          return module
        }),
      ).rejects.toThrow()
    } finally {
      await prisma?.$disconnect()
    }
  })
})
