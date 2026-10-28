import { describe, expect, it, vi } from "vitest"

import { getDatabaseUrl } from "."

describe("getDatabaseUrl()", () => {
  it("returns the current worker URL rather than the administrative URL", () => {
    const url = "postgresql://127.0.0.1/replica_test_0123456789abcdef_1"
    vi.stubEnv("DATABASE_URL", url)
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://127.0.0.1/postgres")

    expect(getDatabaseUrl()).toBe(url)
  })

  it.each([undefined, ""])(
    "rejects a missing worker URL without an administrative fallback: %s",
    (url) => {
      vi.stubEnv("DATABASE_URL", url)
      vi.stubEnv("TEST_DATABASE_URL", "postgresql://127.0.0.1/postgres")

      expect(() => getDatabaseUrl()).toThrow("The database test harness must provide DATABASE_URL.")
    },
  )
})
