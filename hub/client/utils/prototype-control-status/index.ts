import type { Control } from "@utils/prototype-controls/controls.mjs"
import type { ScopeSnapshot } from "@utils/prototype-controls-protocol"
import { copy } from "@utils/prototype-canvas/en"

export function controlStatus(scope: ScopeSnapshot, control: Control) {
  const binding = scope.snapshot.bindings?.[control.id]
  const action = scope.snapshot.actions[control.id]
  return {
    scope: scope.declaration.scope,
    id: control.id,
    visible: scope.snapshot.visible[control.id] === true,
    available:
      (control.type !== "button" || action?.available === true) &&
      (!binding?.error || binding.available === true),
    busy: binding?.busy === true || action?.busy === true,
    error:
      binding?.error ||
      (control.type === "button" && !action?.available ? copy.controlsActionUnavailable : ""),
  }
}
