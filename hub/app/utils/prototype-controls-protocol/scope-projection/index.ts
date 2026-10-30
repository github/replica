import {
  validateControls,
  type Controls,
  type Declaration,
} from "@utils/prototype-controls/controls.mjs"

import type { ScopeSnapshot } from ".."

export function scopeProjection(controller: Controls<Declaration>): ScopeSnapshot {
  validateControls(controller.declaration)
  return JSON.parse(
    JSON.stringify({
      declaration: controller.declaration,
      fingerprint: JSON.stringify(controller.declaration),
      snapshot: controller.getSnapshot(),
    }),
  ) as ScopeSnapshot
}
