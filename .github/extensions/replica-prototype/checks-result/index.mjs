import { createChecksSnapshot } from "../checks-snapshot/index.mjs"
import { createCheckAssessment } from "../checks-assessment/index.mjs"

const outcomes = ["pass", "fail", "unverified"]
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/

export function validateChecksResult(value, check, input) {
  object(value, [
    "version",
    "checkId",
    "fingerprint",
    "outcome",
    "summary",
    "criteria",
    "findings",
    "limitations",
    "readCoverage",
    "coverageReason",
    "scope",
  ])
  const { fingerprint, scope } = createCheckAssessment(check, input)
  if (value.scope !== undefined) {
    object(value.scope, ["files", "contextFiles"])
    if (
      JSON.stringify(value.scope.files) !== JSON.stringify(scope.files) ||
      JSON.stringify(value.scope.contextFiles) !== JSON.stringify(scope.contextFiles)
    )
      throw new Error("The check returned mismatched assessment scope.")
  }
  if (
    value.version !== 2 ||
    value.checkId !== check.id ||
    value.fingerprint !== fingerprint ||
    !outcomes.includes(value.outcome) ||
    !text(value.summary, 400) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 200 ||
    Buffer.byteLength(JSON.stringify({ ...value, readCoverage: undefined, scope: undefined })) >
      256000
  )
    throw new Error("The check returned an invalid or mismatched version 2 result.")
  const definitions = check.criteria ?? []
  const expected = new Set(definitions.map((criterion) => criterion.id))
  const criteria = value.criteria === undefined ? [] : value.criteria
  if (!Array.isArray(criteria) || criteria.length > 50)
    throw new Error("Return each configured criterion once with an outcome and evidence.")
  for (const criterion of criteria) {
    object(criterion, ["id", "status", "evidence", "coverageReason"])
    if (
      !expected.delete(criterion.id) ||
      !outcomes.includes(criterion.status) ||
      !text(criterion.evidence, 400)
    )
      throw new Error("Return each configured criterion once with an outcome and concise evidence.")
  }
  if (expected.size) throw new Error("The check did not assess every configured criterion.")
  if (
    value.limitations !== undefined &&
    (!Array.isArray(value.limitations) ||
      value.limitations.length > 20 ||
      value.limitations.some((item) => !text(item, 400)))
  )
    throw new Error("Report limitations as at most 20 concise explanations.")
  const ids = new Set()
  for (const finding of value.findings) {
    object(finding, [
      "id",
      "severity",
      "title",
      "description",
      "evidence",
      "file",
      "line",
      "criterionId",
    ])
    if (
      typeof finding.id !== "string" ||
      !idPattern.test(finding.id) ||
      ids.has(finding.id) ||
      !["error", "warning", "info"].includes(finding.severity) ||
      !text(finding.title, 200) ||
      !text(finding.description, 2000) ||
      !text(finding.evidence, 1000) ||
      (finding.criterionId !== undefined &&
        !definitions.some((criterion) => criterion.id === finding.criterionId)) ||
      (finding.file !== undefined && !scope.files.includes(finding.file)) ||
      (finding.line !== undefined &&
        (!finding.file || !Number.isSafeInteger(finding.line) || finding.line < 1))
    )
      throw new Error(
        "Findings need a unique ID, severity and in-scope evidence; criterion references must be configured.",
      )
    ids.add(finding.id)
  }
  if (check.runner.type !== "agent" && value.readCoverage !== undefined)
    throw new Error("Source-read coverage is reserved for the background agent runner.")
  const readCoverage =
    value.readCoverage === undefined
      ? undefined
      : createChecksSnapshot(input, scope).validateCoverage(value.readCoverage)
  let coverageReason
  if (check.runner.type === "agent") {
    const required = readCoverage?.files.filter((file) => file.required)
    coverageReason = !readCoverage
      ? "not_recorded"
      : !required.length
        ? "no_source"
        : required.some((file) => file.status !== "read")
          ? "incomplete"
          : undefined
  }
  const normalized = criteria.map(({ id, status, evidence }) => ({
    id,
    status: status === "pass" && coverageReason ? "unverified" : status,
    evidence,
    ...(coverageReason ? { coverageReason } : {}),
  }))
  const outcome =
    value.outcome === "fail" ||
    normalized.some((criterion) => criterion.status === "fail") ||
    value.findings.some((finding) => finding.severity === "error")
      ? "fail"
      : value.outcome === "unverified" ||
          coverageReason ||
          normalized.some((criterion) => criterion.status === "unverified")
        ? "unverified"
        : "pass"
  return {
    version: 2,
    checkId: check.id,
    fingerprint,
    outcome,
    summary: value.summary,
    criteria: normalized,
    findings: value.findings.map((finding) => ({ ...finding })),
    limitations: [...(value.limitations ?? [])],
    scope: {
      files: scope.files,
      contextFiles: scope.contextFiles,
    },
    ...(readCoverage ? { readCoverage } : {}),
    ...(coverageReason ? { coverageReason } : {}),
  }
}

function text(value, maximum) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !value.includes("\0")
  )
}

function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error("The check returned invalid or unsupported report fields.")
}
