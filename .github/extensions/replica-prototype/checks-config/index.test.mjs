import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateChecksConfig } from "./index.mjs"

function config() {
  return {
    version: 2,
    checks: [
      {
        id: "lint",
        name: "Lint",
        inputs: { include: ["src/page.tsx", "src/shared/**"] },
        runner: {
          type: "command",
          command: ["node", "checks/lint.mjs"],
        },
        criteria: [{ id: "clean", name: "No relevant diagnostics" }],
      },
    ],
  }
}

describe("validateChecksConfig()", () => {
  it("accepts explicit file inputs and bounded command checks without a base reference", () => {
    assert.equal(validateChecksConfig(config()).checks[0].runner.type, "command")
  })
  it("rejects the removed command image field rather than silently ignoring it", () => {
    const value = config()
    value.checks[0].runner.image = "legacy-checks-image"
    assert.throws(() => validateChecksConfig(value), /image|unknown|unsupported|additional/i)
  })
  it("accepts schema-location metadata without using it to choose the validator", () => {
    const value = config()
    value.$schema = "https://unavailable.invalid/checks.json"
    assert.equal(validateChecksConfig(value).$schema, value.$schema)
    value.checks[0].runner.command = []
    assert.throws(() => validateChecksConfig(value))
  })
  it("rejects paths escaping the repository and obsolete scoring fields", () => {
    for (const invalid of [
      "../instructions.md",
      "/outside/instructions",
      "src/../page.tsx",
      "src//page.tsx",
      "src\\page.tsx",
      "src/./page.tsx",
      "src/[ab].tsx",
      "src/{page,other}.tsx",
      "src/page?.tsx",
    ]) {
      const value = config()
      value.checks[0].inputs.include = [invalid]
      assert.throws(() => validateChecksConfig(value), /file reference/)
    }
    for (const field of ["weight", "points", "scoring"]) {
      const value = config()
      value.checks[0][field] = 1
      assert.throws(() => validateChecksConfig(value), /Unknown|unsupported/i)
    }
    const value = config()
    value.checks[0].criteria[0].points = 1
    assert.throws(() => validateChecksConfig(value), /Unknown|unsupported/i)
  })
  it("rejects arbitrary host/plugin capabilities and duplicate criterion IDs", () => {
    const value = config()
    value.checks[0].allowWrites = true
    assert.throws(() => validateChecksConfig(value), /Unknown/)
    delete value.checks[0].allowWrites
    value.checks[0].criteria.push(value.checks[0].criteria[0])
    assert.throws(() => validateChecksConfig(value), /unique/)
  })
  it("rejects unknown fields in nested configuration objects", () => {
    for (const select of [
      (value) => value,
      (value) => value.checks[0],
      (value) => value.checks[0].runner,
      (value) => value.checks[0].criteria[0],
      (value) => (value.checks[0].inputs = { include: ["src/**"] }),
    ]) {
      const value = config()
      select(value).unsupported = true
      assert.throws(() => validateChecksConfig(value), /unknown|unsupported|additional/i)
    }
  })
  it("accepts agent instruction references without commands", () => {
    const value = {
      version: 2,
      checks: [
        {
          id: "review",
          name: "Review",
          inputs: { include: ["src/**"] },
          criteria: [],
          runner: { type: "agent", instructions: "checks/review.md" },
        },
      ],
    }
    assert.equal(validateChecksConfig(value).checks[0].runner.type, "agent")
  })
  it("rejects invalid schema metadata, empty checks and unsupported structural branches", () => {
    for (const change of [
      (value) => (value.$schema = 2),
      (value) => (value.version = 3),
      (value) => (value.checks = []),
      (value) => (value.checks[0].runner.type = "shell"),
      (value) => (value.checks[0].runner.capabilities = ["write"]),
      (value) => (value.checks[0].name = "   "),
    ]) {
      const value = config()
      change(value)
      assert.throws(() => validateChecksConfig(value))
    }
  })
  it("rejects removed impact and page fields instead of preserving compatibility", () => {
    for (const [target, field, oldValue] of [
      ["root", "base", "main"],
      ["root", "pages", []],
      ["root", "ignore", ["docs/**"]],
      ["check", "targets", ["page"]],
      ["check", "scenarios", []],
    ]) {
      const value = config()
      ;(target === "root" ? value : value.checks[0])[field] = oldValue
      assert.throws(() => validateChecksConfig(value), /unknown|unsupported|additional/i)
    }
    const value = config()
    value.checks.push(structuredClone(value.checks[0]))
    assert.throws(() => validateChecksConfig(value), /unique|duplicate/i)
  })
  it("keeps explicit inputs separate from context and requires a nonempty include on every check", () => {
    const value = config()
    delete value.checks[0].criteria
    value.checks[0].inputs = {
      include: ["src/**/*.tsx"],
      exclude: ["src/generated/**"],
    }
    value.checks[0].context = ["docs/design.md"]
    const normalized = validateChecksConfig(value)
    assert.equal(Object.hasOwn(normalized, "pages"), false)
    assert.deepEqual(normalized.checks[0].inputs, value.checks[0].inputs)
    assert.deepEqual(normalized.checks[0].context, ["docs/design.md"])
    for (const inputs of [undefined, {}, { exclude: ["src/generated/**"] }, { include: [] }]) {
      value.checks[0].inputs = inputs
      assert.throws(() => validateChecksConfig(value), /input|include|propert|field/i)
    }
  })
  it("rejects legacy configs with an actionable version-two migration error", () => {
    assert.throws(() => validateChecksConfig({ ...config(), version: 1 }), /version.*2|v2/i)
  })
  it("requires exact guidance files rather than globs or traversal", () => {
    for (const file of ["../review.md", "/review.md", "docs/*.md", "docs/../review.md"]) {
      const value = config()
      value.checks[0].context = [file]
      assert.throws(() => validateChecksConfig(value), /file|context|reference/i)
      delete value.checks[0].context
      value.checks[0].runner = { type: "agent", instructions: file }
      assert.throws(() => validateChecksConfig(value), /file|instructions|reference/i)
    }
  })
  it("rejects fields from the other runner branch and criteria on exit-code reports", () => {
    for (const runner of [
      {
        type: "command",
        command: ["node"],
        instructions: "checks/review.md",
      },
      { type: "agent", instructions: "checks/review.md", command: ["node"] },
      { type: "agent", instructions: "checks/review.md", report: "json" },
      {
        type: "agent",
        instructions: "checks/review.md",
        failureExitCodes: [1],
      },
      {
        type: "command",
        command: ["node"],
        report: "exit-code",
      },
    ]) {
      const value = config()
      value.checks[0].runner = runner
      assert.throws(() => validateChecksConfig(value))
    }
  })
  it("accepts numeric limits and rejects out-of-range, fractional and mistyped values", () => {
    for (const [field, minimum, maximum] of [
      ["concurrency", 1, 2],
      ["debounceMs", 500, 30000],
      ["timeoutSeconds", 1, 600],
    ]) {
      for (const boundary of [minimum, maximum]) {
        const value = config()
        const target = field === "timeoutSeconds" ? value.checks[0] : value
        target[field] = boundary
        assert.doesNotThrow(() => validateChecksConfig(value))
      }
      for (const invalid of [minimum - 1, maximum + 1, minimum + 0.5, String(minimum)]) {
        const value = config()
        const target = field === "timeoutSeconds" ? value.checks[0] : value
        target[field] = invalid
        assert.throws(() => validateChecksConfig(value))
      }
    }
    const value = config()
    value.checks[0].automatic = "false"
    assert.throws(() => validateChecksConfig(value))
  })
  it("validates explicit exit-code failure mappings without admitting infrastructure failures", () => {
    const value = config()
    delete value.checks[0].criteria
    value.checks[0].runner.report = "exit-code"
    value.checks[0].runner.failureExitCodes = [2, 123]
    assert.deepEqual(validateChecksConfig(value).checks[0].runner.failureExitCodes, [2, 123])
    for (const codes of [[0], [124], [125], [126], [127], [137], [1, 1], [1.5], []]) {
      value.checks[0].runner.failureExitCodes = codes
      assert.throws(() => validateChecksConfig(value), /exit|failure|distinct|unique/i)
    }
    value.checks[0].runner.failureExitCodes = [1]
    value.checks[0].runner.report = "json"
    assert.throws(() => validateChecksConfig(value), /exit|failure/i)
  })
})
