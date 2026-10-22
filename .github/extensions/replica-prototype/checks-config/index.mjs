import validateShape from "./shape.cjs"

export class ChecksConfigError extends Error {
  constructor(message, issues = [{ path: "/", message }]) {
    super(message)
    this.issues = issues
  }
}

export function validateChecksConfig(value) {
  if (value && typeof value === "object" && value.version !== 2)
    throw new ChecksConfigError(
      "Checks configuration must use version 2. Remove scoring fields and configure a runner object.",
    )
  if (!validateShape(value)) {
    const details = validateShape.errors.slice(0, 8).map((error) => {
      return {
        path: error.instancePath || "/",
        message:
          error.keyword === "additionalProperties"
            ? `Unknown checks configuration field: ${error.params.additionalProperty}.`
            : `${error.message} (${error.schemaPath}).`,
      }
    })
    throw new ChecksConfigError(
      `Invalid checks configuration or file reference:\n${details.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
      details,
    )
  }
  unique(value.checks, "check")
  for (const check of value.checks) {
    unique(check.criteria ?? [], "criterion")
  }
  return value
}

function unique(values, label) {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new ChecksConfigError(`Use unique lowercase ${label} IDs.`)
}
