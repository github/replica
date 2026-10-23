import { describe, expect, it } from "vitest"

import type { Dependency } from "../load-dependencies/types.ts"
import { auditDependencies } from "."

describe("auditDependencies()", () => {
  it("accepts the seven-day boundary and reports newer and unverifiable dependencies together", async () => {
    const dependencies: Dependency[] = ["boundary", "new", "unavailable", "invalid"].map(
      (name) => ({
        ecosystem: "npm",
        name,
        version: "1.0.0",
        source: "package-lock.json",
      }),
    )
    const result = await auditDependencies(dependencies, {
      now: new Date("2026-10-23T12:00:00Z"),
      publishedAt: async ({ name }) => {
        if (name === "unavailable") throw new Error("registry unavailable")
        if (name === "invalid") return "unknown"
        return name === "boundary" ? "2026-10-16T12:00:00Z" : "2026-10-16T12:00:00.001Z"
      },
    })
    expect(result.checkedCount).toBe(4)
    expect(result.cutoff.toISOString()).toBe("2026-10-16T12:00:00.000Z")
    expect(result.failures).toHaveLength(3)
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/npm:new@1.0.0.*published at/),
        expect.stringContaining("registry unavailable"),
        expect.stringContaining("publication time is invalid"),
      ]),
    )
  })
})
