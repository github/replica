import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createCheckAssessment } from "./index.mjs"

function fixture() {
  const check = {
    id: "review",
    name: "Review",
    runner: { type: "agent", instructions: "checks/review.md" },
    inputs: { include: ["src/a/**", "optional.ts"] },
    context: ["guidance.md"],
    criteria: [{ id: "clean", name: "Clean" }],
    timeoutSeconds: 120,
  }
  const input = {
    branch: "prototype",
    head: "a".repeat(40),
    config: {
      concurrency: 1,
      debounceMs: 2000,
      checks: [check],
    },
    files: new Map([
      ["src/a/view.ts", Buffer.from("A source")],
      ["src/b/view.ts", Buffer.from("B source")],
      ["guidance.md", Buffer.from("Team guidance")],
      ["checks/review.md", Buffer.from("Review instructions")],
    ]),
  }
  return { check, input }
}

function reordered(value) {
  if (Array.isArray(value)) return value.map(reordered)
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reordered(item)]),
    )
  return value
}

describe("createCheckAssessment()", () => {
  it("uses one content identity and exposes only file scope and criteria in assessment context", () => {
    const { check, input } = fixture()
    const assessment = createCheckAssessment(check, input)
    assert.equal(assessment.context.version, 2)
    assert.match(assessment.fingerprint, /^[a-f0-9]{64}$/)
    assert.equal(assessment.context.fingerprint, assessment.fingerprint)
    assert.equal(assessment.context.checkId, "review")
    assert.deepEqual(assessment.scope.files, ["optional.ts", "src/a/view.ts"])
    assert.deepEqual(
      Object.keys(assessment.context).sort(),
      ["version", "checkId", "fingerprint", "scope", "criteria"].sort(),
    )
    assert.deepEqual(assessment.context.scope, {
      files: ["optional.ts", "src/a/view.ts"],
      contextFiles: ["guidance.md"],
    })
    input.head = "c".repeat(40)
    const next = createCheckAssessment(check, input)
    assert.equal(next.fingerprint, assessment.fingerprint)
    assert.equal(next.context.fingerprint, assessment.fingerprint)
  })

  it("ignores provenance, scheduling, sibling definitions and unrelated source inventories", () => {
    const { check, input } = fixture()
    const before = createCheckAssessment(check, input).fingerprint
    input.branch = "other"
    input.head = "c".repeat(40)
    input.config.concurrency = 4
    input.config.debounceMs = 9000
    input.config.checks.push({ id: "sibling", runner: { type: "command" } })
    input.files.set("src/b/view.ts", Buffer.from("Updated B"))
    input.files.set("unrelated.ts", Buffer.from("Unrelated"))
    check.automatic = true
    assert.equal(createCheckAssessment(check, input).fingerprint, before)
  })

  it("is deterministic across JSON object property and captured file insertion order", () => {
    const { check, input } = fixture()
    const before = createCheckAssessment(check, input).fingerprint
    input.files = new Map([...input.files].reverse())
    input.config = reordered(input.config)
    assert.equal(createCheckAssessment(reordered(check), input).fingerprint, before)
  })

  for (const [name, change] of [
    ["source bytes", ({ input }) => input.files.set("src/a/view.ts", Buffer.from("Changed"))],
    ["source addition", ({ input }) => input.files.set("src/a/new.ts", Buffer.from(""))],
    ["source deletion", ({ input }) => input.files.delete("src/a/view.ts")],
    [
      "source rename with identical bytes",
      ({ input }) => {
        input.files.set("src/a/renamed.ts", input.files.get("src/a/view.ts"))
        input.files.delete("src/a/view.ts")
      },
    ],
    [
      "absent literal becoming empty",
      ({ input }) => input.files.set("optional.ts", Buffer.from("")),
    ],
    ["guidance bytes", ({ input }) => input.files.set("guidance.md", Buffer.from("New guidance"))],
    [
      "instruction bytes",
      ({ input }) => input.files.set("checks/review.md", Buffer.from("New instructions")),
    ],
    [
      "guidance path with identical bytes",
      ({ check, input }) => {
        input.files.set("other-guidance.md", input.files.get("guidance.md"))
        check.context = ["other-guidance.md"]
      },
    ],
    ["own timeout", ({ check }) => (check.timeoutSeconds = 60)],
    ["own criteria", ({ check }) => (check.criteria[0].name = "New criterion")],
    ["resolved scope", ({ check }) => (check.inputs.include = ["src/a/view.ts"])],
  ]) {
    it(`changes assessment identity for ${name}`, () => {
      const data = fixture()
      const before = createCheckAssessment(data.check, data.input).fingerprint
      change(data)
      assert.notEqual(createCheckAssessment(data.check, data.input).fingerprint, before)
    })
  }

  it("represents missing fake instructions without confusing them with empty instructions", () => {
    const { check, input } = fixture()
    input.files.delete("checks/review.md")
    const missing = createCheckAssessment(check, input)
    input.files.set("checks/review.md", Buffer.from(""))
    assert.notEqual(createCheckAssessment(check, input).fingerprint, missing.fingerprint)
  })
})
