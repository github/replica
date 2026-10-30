import { validControlsValues } from "../../prototype-controls-protocol/valid-values"
import { controlParameter, controlsUrlLimit, type ControlValues } from "../constants"
import { encodeControlValues } from "../encode-control-values"

export function readControlQuery(search: string): { scopes: ControlValues; notice: string } {
  const params = new URLSearchParams(search)
  const entries = [...params].filter(([key]) => key.startsWith("rc."))
  if (new Blob([new URLSearchParams(entries).toString()]).size > controlsUrlLimit)
    return { scopes: {}, notice: "Control settings in this URL exceed 8 KB. Defaults were used." }
  const scopes = new Map<string, Map<string, unknown>>()
  let discarded = false
  for (const [key, text] of entries) {
    const match = controlParameter.exec(key)
    if (!match || params.getAll(key).length !== 1) {
      discarded = true
      continue
    }
    const scope = match[1]!
    const id = match[2]!
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
    if (!validControlsValues({ [id]: value })) {
      discarded = true
      continue
    }
    const values = scopes.get(scope) ?? new Map<string, unknown>()
    values.set(id, value)
    scopes.set(scope, values)
  }
  const values = Object.fromEntries(
    [...scopes].map(([scope, entries]) => [scope, Object.fromEntries(entries)]),
  )
  try {
    encodeControlValues(values)
  } catch {
    return { scopes: {}, notice: "Control settings in this URL exceed 8 KB. Defaults were used." }
  }
  return {
    scopes: values,
    notice: discarded ? "Some URL control settings were invalid. Defaults were used instead." : "",
  }
}
