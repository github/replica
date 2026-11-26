import type { ScopeSnapshot } from "../../prototype-controls-protocol"
import { nonDefaultValues } from "../non-default-values"

export function savedValues(scope: ScopeSnapshot): Record<string, unknown> {
  const appOwned = new Set(
    scope.declaration.controls
      .filter((control) => control.binding?.type === "api" && control.binding.initial === "app")
      .map((control) => control.id),
  )
  return Object.fromEntries(
    Object.entries(nonDefaultValues(scope)).filter(([id]) => !appOwned.has(id)),
  )
}
