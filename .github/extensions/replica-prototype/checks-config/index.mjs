import validateShape from "./shape.cjs"

export function validateChecksConfig(value) {
  if (value && typeof value === "object" && value.version !== 2)
    throw new Error(
      "Checks configuration must use version 2. Remove scoring fields and configure a runner object.",
    )
  if (!validateShape(value)) {
    const details = validateShape.errors.slice(0, 8).map((error) => {
      const location = error.instancePath || "/"
      if (error.keyword === "additionalProperties")
        return `${location}: Unknown checks configuration field: ${error.params.additionalProperty}.`
      return `${location}: ${error.message} (${error.schemaPath}).`
    })
    throw new Error(`Invalid checks configuration or file reference:\n${details.join("\n")}`)
  }
  unique(value.pages ?? [], "page")
  unique(value.checks, "check")
  for (const check of value.checks) {
    if (check.targets?.some((id) => !(value.pages ?? []).some((page) => page.id === id)))
      throw new Error(`Check ${check.id} has unknown target pages.`)
    unique(check.criteria ?? [], "criterion")
    unique(check.scenarios ?? [], "scenario")
    for (const scenario of check.scenarios ?? []) {
      if (
        !(value.pages ?? []).some((page) => page.id === scenario.pageId) ||
        (check.targets && !check.targets.includes(scenario.pageId))
      )
        throw new Error(`Check ${check.id} scenarios must target a page assessed by their check.`)
      if (scenario.state !== undefined && JSON.stringify(scenario.state).length > 16000)
        throw new Error(
          `Check ${check.id} scenario state must be a JSON object under 16000 characters.`,
        )
    }
  }
  return { ...value, pages: value.pages ?? [] }
}

function unique(values, label) {
  if (new Set(values.map((value) => value.id)).size !== values.length)
    throw new Error(`Use unique lowercase ${label} IDs.`)
}
