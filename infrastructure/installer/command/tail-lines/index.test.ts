import { expect, it } from "vitest"

import { tailLines } from "./index.ts"

it("returns short text without a truncation marker", () => {
  expect(tailLines("first\nsecond\n")).toBe("first\nsecond")
})

it("keeps the last lines and marks text truncated by the line bound", () => {
  expect(tailLines("one\ntwo\nthree\nfour", { lines: 2 })).toBe("…\nthree\nfour")
})

it("keeps the last characters and marks a long line truncated by the character bound", () => {
  expect(tailLines("abcdefghij", { characters: 4 })).toBe("…ghij")
})
