import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"

import { resolveCheckScope } from "./index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"

function input() {
  return {
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
  it("excludes only root accessibility review support files while lint and production fixtures retain their scope", async () => {
    const config = JSON.parse(
      await readFile(new URL("../../../../.replica/checks.json", import.meta.url), "utf8"),
    )
    const accessibility = config.checks.find((check) => check.id === "github-a11y-source")
    const lint = config.checks.find((check) => check.id === "lint")
    const excluded = [
      "hub/app/javascript/components/prototype-toolbar/index.test.ts",
      "hub/app/javascript/components/prototype-toolbar/nested/index.test.tsx",
      "hub/app/javascript/utils/prototype-controls/bindings.test.mjs",
      "hub/app/javascript/utils/prototype-controls/controls.test.mjs",
      "hub/app/javascript/components/prototype-toolbar/stories.tsx",
      "hub/app/javascript/utils/prototype-controls/controls-shape.cjs",
    ]
    const production = [
      "hub/app/javascript/components/prototype-toolbar/index.tsx",
      "hub/app/javascript/storybook/fixtures/review/thread.ts",
      "hub/package.json",
      "hub/package-lock.json",
      "hub/tsconfig.json",
      "hub/tsconfig.node.json",
      ".github/extensions/replica-prototype/checks-config/schema.v2.json",
      ".github/extensions/replica-prototype/checks-runner/index.mjs",
      "hub/vite.prototype-canvas.config.mjs",
    ]
    const snapshot = {
      config,
      files: new Map([...excluded, ...production].map((file) => [file, Buffer.from("source")])),
    }
    const original = createCheckAssessment(accessibility, snapshot)
    const originalLint = createCheckAssessment(lint, snapshot).fingerprint
    for (const file of excluded) {
      assert.ok(
        !original.scope.files.includes(file),
        `${file} must not require accessibility review`,
      )
      assert.ok(
        resolveCheckScope(lint, snapshot).files.includes(file),
        `${file} must remain lint input`,
      )
      snapshot.files.set(file, Buffer.from("Changed support file"))
      assert.equal(createCheckAssessment(accessibility, snapshot).fingerprint, original.fingerprint)
    }
    assert.notEqual(createCheckAssessment(lint, snapshot).fingerprint, originalLint)
    for (const file of production) {
      assert.ok(original.scope.files.includes(file), `${file} must remain accessibility input`)
      snapshot.files.set(file, Buffer.from("Changed production input"))
      assert.notEqual(
        createCheckAssessment(accessibility, snapshot).fingerprint,
        original.fingerprint,
      )
      snapshot.files.set(file, Buffer.from("source"))
    }
  })
  it("returns only explicit file scope and separate guidance", () => {
    const snapshot = input()
    const scope = resolveCheckScope(
      {
        runner: { type: "agent", instructions: "review.md" },
        context: ["docs/design.md"],
        inputs: { include: ["src/**"] },
      },
      snapshot,
    )
    assert.deepEqual(Object.keys(scope).sort(), ["contextFiles", "files", "instructionsFile"])
    assert.deepEqual(scope.contextFiles, ["docs/design.md"])
    assert.equal(scope.instructionsFile, "review.md")
    assert.deepEqual(scope.files.sort(), [
      "src/a.tsx",
      "src/b.tsx",
      "src/generated/output.ts",
      "src/shared.ts",
    ])
  })
  it("retains missing literal inputs and applies exclusions to matched files", () => {
    const check = {
      runner: { type: "command" },
      inputs: {
        include: ["src/**/*.tsx", "missing.tsx"],
        exclude: ["src/a.tsx"],
      },
    }
    const snapshot = input()
    const scope = resolveCheckScope(check, snapshot)
    assert.deepEqual(scope.files, ["missing.tsx", "src/b.tsx"])
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
