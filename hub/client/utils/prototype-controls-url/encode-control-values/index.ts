import { validControlsValues } from "../../prototype-controls-protocol/valid-values"
import { controlParameter, controlsUrlLimit, type ControlValues } from "../constants"

export function encodeControlValues(scopes: ControlValues): string {
  const params = new URLSearchParams()
  for (const scope of Object.keys(scopes).sort()) {
    const values = scopes[scope]!
    if (!validControlsValues(values)) throw new Error("Invalid control settings.")
    for (const id of Object.keys(values).sort()) {
      const key = `rc.${scope}.${id}`
      if (!controlParameter.test(key)) throw new Error("Invalid control settings identifier.")
      params.set(key, JSON.stringify(values[id]))
    }
  }
  const query = params.toString()
  if (new Blob([query]).size > controlsUrlLimit)
    throw new Error(
      "Control settings exceed the 8 KB URL limit. Reduce the settings before sharing.",
    )
  return query
}
