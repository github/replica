import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { createCheckAssessment } from "./index.mjs"

function fixture() {
  const pages = [
    { id: "a", name: "A", route: "/a", inputs: ["src/a/**"] },
    { id: "b", name: "B", route: "/b", inputs: ["src/b/**"] },
  ]
  const check = {
    id: "review",
    name: "Review",
    targets: ["a"],
    runner: { type: "agent", instructions: "checks/review.md" },
    inputs: { include: ["src/a/**", "optional.ts"] },
    context: ["guidance.md"],
    criteria: [{ id: "clean", name: "Clean" }],
    scenarios: [
      { id: "a-flow", pageId: "a", name: "A flow", steps: ["Open A"] },
      { id: "b-flow", pageId: "b", name: "B flow", steps: ["Open B"] },
    ],
    timeoutSeconds: 120,
  }
  const input = {
    fingerprint: "captured-run",
    branch: "prototype",
    head: "a".repeat(40),
    base: "b".repeat(40),
    pages: [pages[0]],
    pageFiles: { a: ["src/a/view.ts"], b: ["src/b/view.ts"] },
    config: { base: "main", pages, concurrency: 1, debounceMs: 2000, checks: [check] },
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
  it("separates content identity from immutable run context and normalizes page files", () => {
    const { check, input } = fixture()
    input.pageFiles.a.push("unrelated.ts", "src/a/deleted.ts")
    const assessment = createCheckAssessment(check, input)
    assert.equal(assessment.context.version, 2)
    assert.equal(assessment.context.fingerprint, "captured-run")
    assert.equal(assessment.context.checkId, "review")
    assert.deepEqual(assessment.scope.files, ["optional.ts", "src/a/view.ts"])
    assert.deepEqual(assessment.context.pages[0].files, ["src/a/view.ts"])
    assert.deepEqual(
      assessment.context.scenarios.map((scenario) => scenario.id),
      ["a-flow"],
    )
    assert.deepEqual(assessment.context.scope, {
      files: ["optional.ts", "src/a/view.ts"],
      contextFiles: ["guidance.md"],
    })
    input.fingerprint = "new-run"
    const next = createCheckAssessment(check, input)
    assert.equal(next.fingerprint, assessment.fingerprint)
    assert.equal(next.context.fingerprint, "new-run")
  })

  it("ignores provenance, scheduling, sibling definitions and unrelated source inventories", () => {
    const { check, input } = fixture()
    const before = createCheckAssessment(check, input).fingerprint
    input.fingerprint = "different-snapshot"
    input.branch = "other"
    input.head = "c".repeat(40)
    input.base = "d".repeat(40)
    input.config.base = "origin/main"
    input.config.concurrency = 4
    input.config.debounceMs = 9000
    input.config.ignore = ["README.md"]
    input.config.checks.push({ id: "sibling", runner: { type: "command" } })
    input.config.pages[1].route = "/changed-b"
    input.files.set("src/b/view.ts", Buffer.from("Updated B"))
    input.files.set("unrelated.ts", Buffer.from("Unrelated"))
    input.pageFiles.a.push("unrelated.ts")
    input.pageFiles.b = []
    check.automatic = true
    check.scenarios[1].steps = ["Different inapplicable flow"]
    assert.equal(createCheckAssessment(check, input).fingerprint, before)
  })

  it("is deterministic across JSON object property and captured file insertion order", () => {
    const { check, input } = fixture()
    const before = createCheckAssessment(check, input).fingerprint
    input.files = new Map([...input.files].reverse())
    input.pages = input.pages.map(reordered)
    input.config = reordered(input.config)
    assert.equal(createCheckAssessment(reordered(check), input).fingerprint, before)
  })

  it("includes configured repository-wide pages without depending on changed-page selection", () => {
    const { check, input } = fixture()
    delete check.targets
    input.pages = []
    input.pageFiles = {}
    const assessment = createCheckAssessment(check, input)
    assert.deepEqual(
      assessment.context.pages.map(({ id, files }) => ({ id, files })),
      [
        { id: "a", files: ["src/a/view.ts"] },
        { id: "b", files: [] },
      ],
    )
    input.pages = [input.config.pages[0]]
    input.pageFiles = { a: ["src/a/view.ts", "unrelated.ts"] }
    assert.equal(createCheckAssessment(check, input).fingerprint, assessment.fingerprint)
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
    ["applicable scenario", ({ check }) => (check.scenarios[0].steps = ["Updated A flow"])],
    ["effective page metadata", ({ input }) => (input.pages[0].route = "/new-a")],
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
