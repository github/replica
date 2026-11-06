import { describe, expect, it } from "vitest"

import { buildSchema } from "."

describe("buildSchema", () => {
  it("accepts full SHA-1 and SHA-256 object names without requiring lowercase", () => {
    const commits = ["a".repeat(40), "B".repeat(40), "c".repeat(64), "D".repeat(64)]

    for (const commit of commits) {
      expect(buildSchema.shape.commitSha.parse(commit)).toBe(commit)
    }
  })

  it("rejects incomplete or non-hexadecimal object names", () => {
    const commits = ["", "a".repeat(7), "a".repeat(41), "a".repeat(63), "g".repeat(40)]

    for (const commit of commits) {
      expect(buildSchema.shape.commitSha.safeParse(commit).success).toBe(false)
    }
  })
})
