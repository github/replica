import { createRequire } from "node:module"
import { portabilityProblems } from "./canonical-json.mjs"
import { LearningError, quoteDiagnostic } from "./errors.mjs"
import { digestProblems } from "./records.mjs"

const validators = createRequire(import.meta.url)("./contracts-validators.cjs")

export const RECORD_KINDS = Object.freeze(Object.keys(validators))

/** Kinds stored with a digest. Manifests, proposals, and evidence references have none. */
const SEALED_KINDS = new Set([
  "episode",
  "event",
  "consentGrant",
  "grantWithdrawal",
  "memoryRecord",
  "exportManifest",
  "auditEntry",
  "collection",
  "guidance",
  "deliveredLearning",
  "usageReport",
  "usedLearning",
  "screenshot",
  "score",
])

/**
 * Check a record against its v1 schema, the I-JSON rules, real calendar times, and, unless
 * sealed is false, its digests.
 *
 * @param {string} kind a key of RECORD_KINDS, such as episode or memoryRecord
 * @param {unknown} value
 * @param {{ sealed?: boolean }} [options]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRecord(kind, value, { sealed = true } = {}) {
  if (!Object.hasOwn(validators, kind))
    throw new LearningError("invalid_input", `Unknown record kind: ${kind}`)
  const validate = validators[kind]
  const errors = portabilityProblems(value)
  if (errors.length) return { valid: false, errors }
  if (!validate(value)) return { valid: false, errors: formatErrors(validate.errors) }
  for (const problem of crossFieldProblems(kind, value)) errors.push(problem)
  if (sealed && SEALED_KINDS.has(kind) && !errors.length)
    for (const problem of digestProblems(kind, value)) errors.push(problem)
  return { valid: errors.length === 0, errors }
}

/** Throw invalid_record unless the record is valid. */
export function assertValid(kind, value, options) {
  const result = validateRecord(kind, value, options)
  if (!result.valid)
    throw new LearningError(
      "invalid_record",
      `Invalid ${kind}: ${result.errors.slice(0, 5).join("; ")}`,
      {
        kind,
        errors: result.errors,
      },
    )
  return value
}

function formatErrors(errors = []) {
  const seen = new Set()
  return errors
    .filter((error) => !["if", "anyOf"].includes(error.keyword))
    .map((error) => {
      const at = error.instancePath ? quoteDiagnostic(error.instancePath).slice(1, -1) : "(root)"
      if (error.keyword === "format" && error.params?.format === "date-time")
        return `${at} is not a real calendar time`
      const allowed = error.params?.allowedValues
      const extra = error.params?.additionalProperty
      const detail = Array.isArray(allowed)
        ? ` (${allowed.join(", ")})`
        : typeof extra === "string"
          ? ` (${quoteDiagnostic(extra)})`
          : ""
      return `${at} ${error.message}${detail}`
    })
    .filter((message) => !seen.has(message) && seen.add(message))
}

/**
 * Rules the schemas state but cannot check: a learning names each replaced learning once, and
 * a label or retraction names in parentEventId the same event its payload targets.
 */
function crossFieldProblems(kind, value) {
  const problems = []
  if (kind === "episode")
    for (const [index, event] of (value.timeline ?? []).entries())
      problems.push(
        ...crossFieldProblems("event", event).map((problem) => `/timeline/${index}${problem}`),
      )
  const list = kind === "memoryRecord" ? value.supersedes : undefined
  if (list && new Set(list).size !== list.length)
    problems.push("/supersedes names a learning twice")
  const target =
    kind === "event" && ["annotation", "no_annotation", "retraction"].includes(value.type)
      ? value.payload?.target
      : undefined
  if (target !== undefined && target?.eventId !== value.parentEventId)
    problems.push("/parentEventId must name the event the payload targets")
  return problems
}
