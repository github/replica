import type { ScopeSnapshot } from "../../prototype-controls-protocol"

export function nonDefaultValues(scope: ScopeSnapshot): Record<string, unknown> {
  return Object.fromEntries(
    scope.declaration.controls
      .filter(
        (control) =>
          control.type !== "button" &&
          scope.snapshot.visible[control.id] &&
          JSON.stringify(scope.snapshot.values[control.id]) !== JSON.stringify(control.default),
      )
      .map((control) => [control.id, scope.snapshot.values[control.id]]),
  )
}
