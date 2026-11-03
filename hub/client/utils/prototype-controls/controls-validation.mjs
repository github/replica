import validators from "./controls-shape.cjs"
export { conditionMatches } from "./controls-shared.mjs"

const { validateDocumentShape, validateDeclaration } = validators
const branches = {
  boolean: "boolean",
  number: "number",
  slider: "slider",
  select: "choice",
  radio: "choice",
  segmented: "choice",
  checkboxGroup: "checkboxGroup",
  text: "text",
  textarea: "text",
  color: "color",
  button: "button",
}

function shapeIssues(declaration) {
  // oneOf errors from unrelated control branches obscure the actual authoring error.
  const errors = [...validateDeclaration.errors]
    .filter((e) => !/^\/controls\/\d+(?:\/|$)/.test(e.instancePath))
    .map((e) => ({ ...e }))
  if (Array.isArray(declaration?.controls)) {
    declaration.controls.forEach((control, index) => {
      const branch = Object.hasOwn(branches, control?.type) ? branches[control.type] : undefined
      const validator = branch && validators[branch]
      if (!validator) {
        errors.push({
          instancePath: `/controls/${index}/type`,
          message: "must name a supported control type",
        })
      } else if (!validator(control)) {
        errors.push(
          ...validator.errors.map((e) => ({
            ...e,
            instancePath: `/controls/${index}${e.instancePath}`,
          })),
        )
      }
    })
  }
  return errors.map((e) => ({
    path: e.instancePath,
    message:
      e.keyword === "additionalProperties"
        ? `${e.message}: "${e.params.additionalProperty}"`
        : e.message,
    keyword: e.keyword,
    params: e.params,
  }))
}

export class ControlsValidationError extends Error {
  constructor(issues) {
    super(
      `Invalid controls.replica.json:\n${issues.map((i) => `  ${i.path || "/"}: ${i.message}`).join("\n")}`,
    )
    this.name = "ControlsValidationError"
    this.issues = issues
  }
}

export function valueIssue(control, value) {
  switch (control.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "must be a boolean"
    case "number":
    case "slider": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number"
      if (control.min !== undefined && value < control.min) return "must be >= min"
      if (control.max !== undefined && value > control.max) return "must be <= max"
      const units = (value - control.min) / (control.step ?? 1)
      if (!Number.isFinite(units) || Math.abs(units - Math.round(units)) > 1e-8)
        return "must align with step (anchored at min)"
      return null
    }
    case "select":
    case "radio":
    case "segmented":
      return control.options.includes(value) ? null : "must be a declared option"
    case "checkboxGroup":
      return Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((option) => control.options.includes(option))
        ? null
        : "must be unique declared options"
    case "text":
    case "textarea":
      if (typeof value !== "string") return "must be a string"
      // JSON Schema counts Unicode code points, not UTF-16 code units.
      if (control.minLength !== undefined && [...value].length < control.minLength)
        return "shorter than minLength"
      if (control.maxLength !== undefined && [...value].length > control.maxLength)
        return "longer than maxLength"
      return null
    case "color":
      return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
        ? null
        : "must be a six-digit hex color"
    default:
      return "button controls have no value"
  }
}

export function conditionReferences(condition) {
  if (!condition) return []
  if (condition.control) return [condition.control]
  return (condition.all ?? condition.any).flatMap(conditionReferences)
}

// Return dependencies first so hidden-default normalization is a single atomic pass.
export function controlOrder(declaration) {
  const groups = new Map((declaration.groups ?? []).map((g) => [g.id, g]))
  const controls = new Map(declaration.controls.map((c) => [c.id, c]))
  const visited = new Set()
  const visiting = new Set()
  const order = []
  function visit(id) {
    if (visited.has(id)) return
    if (visiting.has(id))
      throw new ControlsValidationError([
        {
          path: `/controls/${id}/when`,
          message: "conditional dependency cycle (including groups)",
        },
      ])
    visiting.add(id)
    const control = controls.get(id)
    for (const ref of [
      ...conditionReferences(control.when),
      ...conditionReferences(groups.get(control.group)?.when),
    ])
      visit(ref)
    visiting.delete(id)
    visited.add(id)
    order.push(id)
  }
  for (const id of controls.keys()) visit(id)
  return order
}

function boundedDocument(declaration) {
  // Bound recursive input before Ajv traverses it (also protects non-JSON callers).
  const seen = new Set()
  function bounded(value, depth = 0) {
    if (depth > 24)
      throw new ControlsValidationError([{ path: "/", message: "document nesting exceeds 24" }])
    if (typeof value === "number" && !Number.isFinite(value))
      throw new ControlsValidationError([{ path: "/", message: "numbers must be finite" }])
    if (!["string", "number", "boolean", "object"].includes(typeof value))
      throw new ControlsValidationError([{ path: "/", message: "must contain only JSON values" }])
    if (!value || typeof value !== "object") return
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new ControlsValidationError([{ path: "/", message: "must contain only JSON objects" }])
    if (seen.has(value))
      throw new ControlsValidationError([
        { path: "/", message: "must be an acyclic JSON document" },
      ])
    seen.add(value)
    for (const item of Object.values(value)) bounded(item, depth + 1)
    seen.delete(value)
  }
  bounded(declaration)
}

export function validateControlsDocument(document) {
  boundedDocument(document)
  const sets =
    document && typeof document === "object" && Object.hasOwn(document, "sets")
      ? document.sets
      : [document]
  if (!document || typeof document !== "object" || !Object.hasOwn(document, "sets")) {
    validateControls(document)
    validateBindings(document)
    return document
  }
  if (!validateDocumentShape(document))
    throw new ControlsValidationError(
      validateDocumentShape.errors.map((error) => ({
        path: error.instancePath,
        message:
          error.keyword === "additionalProperties"
            ? `${error.message}: "${error.params.additionalProperty}"`
            : error.message,
        keyword: error.keyword,
        params: error.params,
      })),
    )
  const scopes = new Set()
  sets.forEach((declaration, index) => {
    try {
      validateControls(declaration)
      validateBindings(declaration)
    } catch (error) {
      if (!(error instanceof ControlsValidationError)) throw error
      throw new ControlsValidationError(
        error.issues.map((issue) => ({
          ...issue,
          path: `/sets/${index}${issue.path}`,
        })),
      )
    }
    if (scopes.has(declaration.scope))
      throw new ControlsValidationError([
        {
          path: `/sets/${index}/scope`,
          message: `duplicate scope ${declaration.scope}`,
        },
      ])
    scopes.add(declaration.scope)
  })
  return document
}

function validateBindings(declaration) {
  const issues = []
  for (const [index, control] of declaration.controls.entries()) {
    const binding = control.binding
    const path = `/controls/${index}/binding`
    if (!binding) {
      issues.push({ path, message: "each control requires a binding" })
      continue
    }
    if (
      (control.type === "button" && !["button", "api"].includes(binding.type)) ||
      (control.type !== "button" && binding.type === "button")
    )
      issues.push({ path, message: "binding does not match the control type" })
    if (binding.type === "query" && (binding.key === "rc" || binding.key.startsWith("rc.")))
      issues.push({ path, message: "rc and rc.* are reserved for control settings" })
    if (binding.type === "api") {
      if (
        [
          "window",
          "globalThis",
          "self",
          "parent",
          "top",
          "document",
          "location",
          "history",
          "navigator",
        ].includes(binding.object.split(".")[0]) ||
        [binding.read, binding.write, binding.action, binding.subscribe].some((method) =>
          ["eval", "Function"].includes(method),
        )
      )
        issues.push({
          path,
          message: "API bindings must name an app-owned object and ordinary methods",
        })
      if (
        binding.object
          .split(".")
          .some((part) => ["constructor", "prototype", "__proto__"].includes(part))
      )
        issues.push({ path, message: "API object must name the app's own exposed object" })
      if (control.type === "button") {
        if (!binding.action || binding.read || binding.write || binding.subscribe || binding.pollMs)
          issues.push({ path, message: "API buttons require only object and action" })
      } else if (
        !binding.read ||
        !binding.write ||
        binding.action ||
        Boolean(binding.subscribe) === Boolean(binding.pollMs)
      )
        issues.push({
          path,
          message: "API values require read, write, and either subscribe or pollMs",
        })
    }
  }
  if (issues.length) throw new ControlsValidationError(issues)
}

export function validateControls(declaration) {
  boundedDocument(declaration)
  if (!validateDeclaration(declaration)) throw new ControlsValidationError(shapeIssues(declaration))
  const issues = []
  function issue(path, message) {
    issues.push({ path, message })
  }
  const ids = new Set()
  const groups = new Map((declaration.groups ?? []).map((g) => [g.id, g]))
  const controls = new Map(declaration.controls.map((c) => [c.id, c]))
  for (const [kind, items] of [
    ["groups", declaration.groups ?? []],
    ["controls", declaration.controls],
  ]) {
    items.forEach((item, index) => {
      if (ids.has(item.id)) issue(`/${kind}/${index}/id`, `duplicate ID ${item.id}`)
      ids.add(item.id)
    })
  }
  function checkCondition(condition, path, depth = 0) {
    if (!condition) return
    if (depth > 4) {
      issue(path, "conditions support at most five levels")
      return
    }
    if (condition.all || condition.any) {
      const operator = condition.all ? "all" : "any"
      condition[operator].forEach((c, i) =>
        checkCondition(c, `${path}/${operator}/${i}`, depth + 1),
      )
      return
    }
    const ref = controls.get(condition.control)
    if (!ref || ref.type === "button") {
      issue(path, "condition must reference a value control")
      return
    }
    if ("includes" in condition) {
      if (ref.type !== "checkboxGroup" || !ref.options.includes(condition.includes))
        issue(path, "includes requires a declared checkboxGroup option")
    } else if (ref.type === "checkboxGroup") {
      issue(path, "checkboxGroup conditions must use includes")
    } else {
      for (const value of "in" in condition ? condition.in : [condition.equals]) {
        const error = valueIssue(ref, value)
        if (error) issue(path, `invalid condition for ${ref.id}: ${error}`)
      }
    }
  }
  declaration.controls.forEach((control, index) => {
    const path = `/controls/${index}`
    if (control.group && !groups.has(control.group)) issue(`${path}/group`, "unknown group")
    if (control.min !== undefined && control.max !== undefined && control.min > control.max)
      issue(path, "min must not exceed max")
    if (
      control.minLength !== undefined &&
      control.maxLength !== undefined &&
      control.minLength > control.maxLength
    )
      issue(path, "minLength must not exceed maxLength")
    if (control.type === "segmented" && control.options.length > 3)
      issue(`${path}/options`, "segmented supports at most three options")
    if (control.type !== "button") {
      const error = valueIssue(control, control.default)
      if (error) issue(`${path}/default`, error)
    }
    checkCondition(control.when, `${path}/when`)
  })
  ;(declaration.groups ?? []).forEach((g, i) => checkCondition(g.when, `/groups/${i}/when`))
  if (issues.length) throw new ControlsValidationError(issues)
  controlOrder(declaration)
  return declaration
}
