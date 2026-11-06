import type { ControlsState } from "@utils/prototype-controls-protocol"
import { controlStatus } from "@utils/prototype-control-status"

/** Uses the same binding and action snapshots that render the Controls fields. */
export function controlsStatus(state: ControlsState, pending: boolean, url: string) {
  return {
    status: pending ? "pending" : state.status,
    url,
    error: pending ? "" : (state.error ?? ""),
    controls: pending
      ? []
      : state.scopes.flatMap((scope) =>
          scope.declaration.controls.map((control) => controlStatus(scope, control)),
        ),
  }
}
