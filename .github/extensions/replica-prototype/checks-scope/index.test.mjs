import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { resolveCheckScope } from "./index.mjs"

function input() {
  return {
    pages: [{ id: "a" }],
    pageFiles: { a: ["src/a.tsx", "src/shared.ts"], b: ["src/b.tsx"] },
    files: new Map(
      [
        "src/a.tsx",
        "src/b.tsx",
        "src/shared.ts",
        "src/generated/output.ts",
        "docs/design.md",
        "review.md",
        ".replica/checks.json",
      ].map((file) => [file, Buffer.from("fixture")]),
    ),
  }
}

describe("resolveCheckScope()", () => {
  it("uses repository-wide source without inventing page dependencies", () => {
    const snapshot = input()
    snapshot.pages = []
    const scope = resolveCheckScope(
      { runner: { type: "agent", instructions: "review.md" }, context: ["docs/design.md"] },
      snapshot,
    )
    assert.deepEqual(scope.pages, [])
    assert.deepEqual(scope.contextFiles, ["docs/design.md"])
    assert.equal(scope.instructionsFile, "review.md")
    assert.deepEqual(scope.files.sort(), [
      "src/a.tsx",
      "src/b.tsx",
      "src/generated/output.ts",
      "src/shared.ts",
    ])
  })
  it("uses only affected target dependencies unless explicit inputs override the dependency group", () => {
    const check = { targets: ["a", "b"], runner: { type: "command" } }
    const snapshot = input()
    const scope = resolveCheckScope(check, snapshot)
    assert.deepEqual(
      scope.pages.map((page) => page.id),
      ["a"],
    )
    assert.deepEqual(scope.files.sort(), ["src/a.tsx", "src/shared.ts"])
    const explicit = resolveCheckScope(
      { ...check, inputs: { include: ["src/**/*.tsx", "missing.tsx"], exclude: ["src/a.tsx"] } },
      snapshot,
    )
    assert.deepEqual(explicit.files.sort(), ["missing.tsx", "src/b.tsx"])
    const unrelated = resolveCheckScope({ ...check, targets: ["b"] }, snapshot)
    assert.deepEqual(unrelated.pages, [])
    assert.deepEqual(unrelated.files, [])
  })
  it("subtracts exclusions and guidance even when broad globs would include them", () => {
    const scope = resolveCheckScope(
      {
        runner: { type: "agent", instructions: "review.md" },
        context: ["docs/design.md"],
        inputs: { include: ["**"], exclude: ["src/generated/**"] },
      },
      input(),
    )
    assert.deepEqual(scope.files.sort(), ["src/a.tsx", "src/b.tsx", "src/shared.ts"])
  })
})
