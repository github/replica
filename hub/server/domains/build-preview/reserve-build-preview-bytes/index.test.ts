import { describe, expect, it } from "vitest"

import { reserveBuildPreviewBytes } from "."

describe("reserveBuildPreviewBytes()", () => {
  it("bounds empty and small reads without making released capacity available twice", () => {
    const remaining = reserveBuildPreviewBytes(100 * 1024 * 1024 - 64 * 1024)
    const empty = reserveBuildPreviewBytes(0)
    let small: (() => void) | null = null

    try {
      expect(remaining).toBeTypeOf("function")
      expect(empty).toBeTypeOf("function")
      expect(reserveBuildPreviewBytes(1)).toBeNull()

      empty?.()
      empty?.()
      small = reserveBuildPreviewBytes(1)

      expect(small).toBeTypeOf("function")
      expect(reserveBuildPreviewBytes(1)).toBeNull()
    } finally {
      remaining?.()
      empty?.()
      small?.()
    }
  })
})
