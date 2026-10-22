import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateChecksResult } from "./index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"
import { createChecksSnapshot } from "../checks-snapshot/index.mjs"
import { resolveCheckScope } from "../checks-scope/index.mjs"

const check = {
  id: "review",
  runner: { type: "command" },
  inputs: { include: ["**"] },
  criteria: [{ id: "usage" }, { id: "semantics" }],
}
function input() {
  return {
    files: new Map([
      ["src/a.tsx", Buffer.from("source a")],
      ["src/b.tsx", Buffer.from("source b")],
    ]),
  }
}
function result(definition = check, snapshot = input()) {
  return {
    version: 2,
    checkId: "review",
    fingerprint: createCheckAssessment(definition, snapshot).fingerprint,
    outcome: "pass",
    summary: "Reviewed the captured source.",
    criteria: [
      { id: "usage", status: "pass", evidence: "Uses the approved component." },
      { id: "semantics", status: "pass", evidence: "The label is present." },
    ],
    findings: [],
  }
}
function finding() {
  return {
    id: "label",
    severity: "error",
    title: "Missing label",
    description: "Add the label.",
    evidence: "src/a.tsx has an unlabelled input.",
    file: "src/a.tsx",
    line: 1,
  }
}

describe("validateChecksResult()", () => {
  it("derives report identity from source and check definition rather than a supplied capture identity", () => {
    const snapshot = input()
    const raw = result(check, snapshot)
    snapshot.fingerprint = raw.fingerprint
    assert.equal(validateChecksResult(raw, check, snapshot).fingerprint, raw.fingerprint)
    snapshot.files.set("src/a.tsx", Buffer.from("changed source"))
    assert.throws(() => validateChecksResult(raw, check, snapshot), /mismatched|invalid/i)
    assert.throws(
      () => validateChecksResult(raw, { ...check, timeoutSeconds: 10 }, input()),
      /mismatched|invalid/i,
    )
  })
  it("assesses each criterion once across input files without numeric scoring", () => {
    const value = validateChecksResult(result(), check, input())
    assert.equal(value.version, 2)
    assert.equal(value.outcome, "pass")
    assert.equal(value.criteria.length, 2)
    for (const field of ["score", "points", "weight"]) assert.equal(field in value, false)
  })
  it("normalizes failed criteria and error findings without upgrading declared uncertainty or failure", () => {
    for (const declared of ["pass", "fail", "unverified"]) {
      const raw = { ...result(), outcome: declared }
      assert.equal(validateChecksResult(raw, check, input()).outcome, declared)
      raw.criteria[0].status = "unverified"
      assert.equal(
        validateChecksResult(raw, check, input()).outcome,
        declared === "fail" ? "fail" : "unverified",
      )
      raw.findings = [finding()]
      assert.equal(validateChecksResult(raw, check, input()).outcome, "fail")
      raw.findings = []
      raw.criteria[0].status = "fail"
      assert.equal(validateChecksResult(raw, check, input()).outcome, "fail")
    }
  })
  it("allows warning and informational findings without page or criterion references", () => {
    const raw = result()
    raw.findings = ["warning", "info"].map((severity) => ({
      ...finding(),
      id: severity,
      severity,
    }))
    assert.equal(validateChecksResult(raw, check, input()).outcome, "pass")
    delete raw.criteria
    raw.fingerprint = createCheckAssessment({ ...check, criteria: [] }, input()).fingerprint
    assert.deepEqual(validateChecksResult(raw, { ...check, criteria: [] }, input()).criteria, [])
  })
  it("rejects missing, duplicate and page-specific criteria instead of accepting partial results", () => {
    const missing = result()
    missing.criteria.pop()
    assert.throws(() => validateChecksResult(missing, check, input()), /every|criterion|criteria/i)
    const duplicate = result()
    duplicate.criteria[1] = duplicate.criteria[0]
    assert.throws(() => validateChecksResult(duplicate, check, input()), /once|criterion|criteria/i)
    const perPage = result()
    perPage.criteria[0].pageId = "a"
    assert.throws(() => validateChecksResult(perPage, check, input()), /unknown|field|criterion/i)
  })
  it("rejects legacy, unknown and unbounded worker fields", () => {
    for (const patch of [
      { version: 1 },
      { fingerprint: "old" },
      { summary: "" },
      { summary: "x".repeat(401) },
      { outcome: "success" },
      { outcome: "not_applicable" },
      { score: 100 },
      { points: 2 },
      { findings: undefined },
      { limitations: ["x".repeat(401)] },
    ]) {
      assert.throws(() => validateChecksResult({ ...result(), ...patch }, check, input()))
    }
    for (const patch of [{ evidence: "" }, { evidence: "x".repeat(401) }, { points: 1 }]) {
      const raw = result()
      Object.assign(raw.criteria[0], patch)
      assert.throws(() => validateChecksResult(raw, check, input()))
    }
  })
  it("validates finding identity, references and assessed-source locations", () => {
    for (const patch of [
      { severity: "fatal" },
      { pageId: "a" },
      { criterionId: "unknown" },
      { file: "src/unrelated.tsx" },
      { file: undefined, line: 1 },
      { line: 0 },
      { line: 1.5 },
      { title: "" },
      { evidence: "x".repeat(1001) },
      { score: 1 },
    ]) {
      const raw = { ...result(), findings: [{ ...finding(), ...patch }] }
      assert.throws(() => validateChecksResult(raw, check, input()))
    }
    assert.throws(() =>
      validateChecksResult({ ...result(), findings: [finding(), finding()] }, check, input()),
    )
    assert.throws(() =>
      validateChecksResult(
        {
          ...result(),
          scope: {
            ...createCheckAssessment(check, input()).context.scope,
            pages: [],
          },
        },
        check,
        input(),
      ),
    )
  })
  it("downgrades unsupported passes while preserving failures, findings and declared uncertainty", () => {
    const snapshot = input()
    snapshot.files.set("src/a.tsx", Buffer.from("x".repeat(10000)))
    const reader = createChecksSnapshot(snapshot, resolveCheckScope(check, snapshot))
    reader.read({ file: "src/a.tsx" })
    const agent = { ...check, runner: { type: "agent" } }
    const raw = result(agent, snapshot)
    raw.criteria[1].status = "fail"
    raw.findings = [finding()]
    const value = validateChecksResult({ ...raw, readCoverage: reader.coverage() }, agent, snapshot)
    assert.equal(value.outcome, "fail")
    assert.equal(value.coverageReason, "incomplete")
    assert.equal(value.criteria[0].status, "unverified")
    assert.equal(value.criteria[0].coverageReason, "incomplete")
    assert.equal(value.criteria[1].status, "fail")
    assert.equal(value.findings.length, 1)
    for (const file of snapshot.files.keys()) {
      let offset = 0
      do {
        offset = JSON.parse(reader.read({ file, offset })).nextOffset
      } while (offset !== null)
    }
    const uncertain = {
      ...result(agent, snapshot),
      outcome: "unverified",
      readCoverage: reader.coverage(),
    }
    assert.equal(validateChecksResult(uncertain, agent, snapshot).outcome, "unverified")
  })
  it("requires authoritative coverage for agent passes and rejects command receipts", () => {
    const agent = { ...check, runner: { type: "agent" } }
    const value = validateChecksResult(result(agent), agent, input())
    assert.equal(value.outcome, "unverified")
    assert.equal(value.coverageReason, "not_recorded")
    assert.throws(
      () => validateChecksResult({ ...result(), readCoverage: {} }, check, input()),
      /reserved|coverage/i,
    )
  })
  it("does not require binary assets and cannot certify an asset-only or empty assessment scope", () => {
    const snapshot = input()
    snapshot.files = new Map([
      ["src/a.tsx", Buffer.from("source")],
      ["image.png", Buffer.from([0, 1])],
    ])
    const agent = { ...check, runner: { type: "agent" } }
    const reader = createChecksSnapshot(snapshot, resolveCheckScope(agent, snapshot))
    reader.read({ file: "src/a.tsx" })
    assert.equal(
      validateChecksResult(
        { ...result(agent, snapshot), readCoverage: reader.coverage() },
        agent,
        snapshot,
      ).outcome,
      "pass",
    )
    for (const files of [["image.png"], []]) {
      snapshot.files = new Map(files.map((file) => [file, Buffer.from([0, 1])]))
      const noSource = createChecksSnapshot(snapshot, resolveCheckScope(agent, snapshot))
      const value = validateChecksResult(
        { ...result(agent, snapshot), readCoverage: noSource.coverage() },
        agent,
        snapshot,
      )
      assert.equal(value.outcome, "unverified")
      assert.equal(value.coverageReason, "no_source")
    }
  })
})
