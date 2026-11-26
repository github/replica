import type { Declaration } from "@utils/prototype-controls/controls.mjs"

import type { ControlValues } from "../constants"

export function excludeAppOwnedValues(
  values: ControlValues,
  declarations: readonly Declaration[],
): ControlValues {
  const result = structuredClone(values)
  for (const declaration of declarations) {
    if (!Object.hasOwn(result, declaration.scope)) continue
    const scope = result[declaration.scope]
    if (!scope) continue
    for (const control of declaration.controls)
      if (control.binding?.type === "api" && control.binding.initial === "app")
        delete scope[control.id]
  }
  return result
}
