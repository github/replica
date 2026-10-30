import { validateControls, valueIssue } from "@utils/prototype-controls/controls.mjs"

import type { ControlsState } from ".."
import { validControlsScopeErrors } from "../valid-scope-errors"

export function validControlsState(value: unknown): value is ControlsState {
  if (!value || typeof value !== "object") return false
  const state = value as ControlsState
  if (typeof state.runtimeAvailable !== "boolean") return false
  if (state.reconnectRequired !== undefined && typeof state.reconnectRequired !== "boolean")
    return false
  if (state.status === "ready" && (!state.runtimeAvailable || !state.scopes?.length)) return false
  if (state.error !== undefined && (typeof state.error !== "string" || state.error.length > 1000))
    return false
  if (state.scopeErrors !== undefined && !validControlsScopeErrors(state.scopeErrors)) return false
  if (
    !["ready", "no-controls", "missing-runtime", "unsupported-runtime", "invalid-config"].includes(
      state.status,
    ) ||
    !Array.isArray(state.scopes) ||
    state.scopes.length > 100 ||
    (state.status !== "ready" && state.scopes.length > 0)
  )
    return false
  try {
    const scopes = new Set<string>()
    for (const scope of state.scopes) {
      validateControls(scope.declaration)
      if (scopes.has(scope.declaration.scope)) return false
      scopes.add(scope.declaration.scope)
      if (
        scope.fingerprint !== JSON.stringify(scope.declaration) ||
        !Number.isSafeInteger(scope.snapshot.revision) ||
        scope.snapshot.revision < 0
      )
        return false
      const snapshot = scope.snapshot
      if (!snapshot.values || !snapshot.visible || !snapshot.groups || !snapshot.actions)
        return false
      function keysMatch(value: object, expected: string[]) {
        return (
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === expected.length &&
          expected.every((key) => Object.hasOwn(value, key))
        )
      }
      if (
        !keysMatch(
          snapshot.values,
          scope.declaration.controls
            .filter((control) => control.type !== "button")
            .map((control) => control.id),
        ) ||
        !keysMatch(
          snapshot.visible,
          scope.declaration.controls.map((control) => control.id),
        ) ||
        !keysMatch(
          snapshot.groups,
          (scope.declaration.groups ?? []).map((group) => group.id),
        ) ||
        !keysMatch(
          snapshot.actions,
          scope.declaration.controls
            .filter((control) => control.type === "button")
            .map((control) => control.id),
        )
      )
        return false
      if (Object.values(snapshot.groups).some((visible) => typeof visible !== "boolean"))
        return false
      if (snapshot.bindings !== undefined) {
        if (
          !snapshot.bindings ||
          typeof snapshot.bindings !== "object" ||
          Array.isArray(snapshot.bindings)
        )
          return false
        for (const [id, binding] of Object.entries(snapshot.bindings))
          if (
            !scope.declaration.controls.some((control) => control.id === id) ||
            !binding ||
            typeof binding.error !== "string" ||
            binding.error.length > 500 ||
            typeof binding.busy !== "boolean" ||
            (binding.available !== undefined && typeof binding.available !== "boolean")
          )
            return false
      }
      for (const control of scope.declaration.controls) {
        if (typeof snapshot.visible[control.id] !== "boolean") return false
        if (control.type === "button") {
          const action = snapshot.actions[control.id]
          if (!action || typeof action.available !== "boolean" || typeof action.busy !== "boolean")
            return false
        } else if (valueIssue(control, snapshot.values[control.id])) return false
      }
    }
    return true
  } catch {
    return false
  }
}
