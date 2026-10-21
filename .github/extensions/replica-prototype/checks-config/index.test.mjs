import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateChecksConfig } from "./index.mjs"

function config() {
  return {
    version: 2,
    base: "main",
    pages: [
      {
        id: "page",
        name: "Page",
        route: "/page",
        inputs: ["src/page.tsx", "src/shared/**"],
      },
    ],
    checks: [
      {
        id: "lint",
        name: "Lint",
        runner: {
          type: "command",
          image: "node:24",
          command: ["node", "checks/lint.mjs"],
        },
        criteria: [{ id: "clean", name: "No relevant diagnostics" }],
      },
    ],
  }
}

describe("validateChecksConfig()", () => {
  it("accepts declarative page/shared dependencies and bounded command checks", () => {
    assert.equal(validateChecksConfig(config()).checks[0].runner.type, "command")
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
      value.pages[0].inputs = [invalid]
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
      (value) => value.pages[0],
      (value) => value.checks[0],
      (value) => value.checks[0].runner,
      (value) => value.checks[0].criteria[0],
      (value) => (value.checks[0].inputs = { include: ["src/**"] }),
      (value) => {
        value.checks[0].scenarios = [
          {
            id: "default",
            name: "Default",
            pageId: "page",
            viewport: { width: 1280, height: 720 },
            expectations: ["Page is readable."],
          },
        ]
        return value.checks[0].scenarios[0]
      },
    ]) {
      const value = config()
      select(value).unsupported = true
      assert.throws(() => validateChecksConfig(value), /unknown|unsupported|additional/i)
    }
  })
  it("accepts agent instruction references without commands", () => {
    const value = config()
    value.checks[0] = {
      ...value.checks[0],
      runner: { type: "agent", instructions: "checks/review.md" },
    }
    assert.equal(validateChecksConfig(value).checks[0].runner.type, "agent")
  })
  it("validates bounded scenarios against the check's declared page targets", () => {
    const value = config()
    value.checks[0].scenarios = [
      {
        id: "keyboard",
        name: "Keyboard scenario",
        pageId: "page",
        viewport: { width: 1280, height: 720 },
        state: { expanded: true },
        expectations: ["The menu is reachable with a keyboard."],
      },
    ]
    assert.equal(validateChecksConfig(value).checks[0].scenarios[0].pageId, "page")
    value.checks[0].scenarios[0].pageId = "unknown"
    assert.throws(() => validateChecksConfig(value), /page/)
    value.checks[0].scenarios[0].pageId = "page"
    value.checks[0].scenarios[0].viewport.width = 0
    assert.throws(() => validateChecksConfig(value), /viewport/i)
  })
  it("retains semantic page targeting, unique IDs and serialized scenario-state limits", () => {
    const value = config()
    value.pages.push({ ...value.pages[0], id: "other", route: "/other" })
    value.checks[0].targets = ["page"]
    value.checks[0].scenarios = [
      {
        id: "default",
        name: "Default",
        pageId: "other",
        viewport: { width: 1280, height: 720 },
        state: { text: "x".repeat(15989) },
        expectations: ["Page is readable."],
      },
    ]
    assert.throws(() => validateChecksConfig(value), /page|target/i)
    value.checks[0].scenarios[0].pageId = "page"
    assert.doesNotThrow(() => validateChecksConfig(value))
    value.checks[0].scenarios[0].state.text += "x"
    assert.throws(() => validateChecksConfig(value), /state|16000/i)
    delete value.checks[0].scenarios
    value.pages[1].id = "page"
    assert.throws(() => validateChecksConfig(value), /unique|duplicate/i)
    value.pages.pop()
    value.checks.push(structuredClone(value.checks[0]))
    assert.throws(() => validateChecksConfig(value), /unique|duplicate/i)
  })
  it("accepts repository-wide checks without pages or criteria and keeps inputs separate from context", () => {
    const value = config()
    delete value.pages
    delete value.checks[0].criteria
    value.checks[0].inputs = {
      include: ["src/**/*.tsx"],
      exclude: ["src/generated/**"],
    }
    value.checks[0].context = ["docs/design.md"]
    const normalized = validateChecksConfig(value)
    assert.deepEqual(normalized.pages, [])
    assert.deepEqual(normalized.checks[0].inputs, value.checks[0].inputs)
    assert.deepEqual(normalized.checks[0].context, ["docs/design.md"])
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
        image: "node:24",
        command: ["node"],
        instructions: "checks/review.md",
      },
      { type: "agent", instructions: "checks/review.md", command: ["node"] },
      { type: "agent", instructions: "checks/review.md", image: "node:24" },
      { type: "agent", instructions: "checks/review.md", report: "json" },
      {
        type: "agent",
        instructions: "checks/review.md",
        failureExitCodes: [1],
      },
      {
        type: "command",
        image: "node:24",
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
