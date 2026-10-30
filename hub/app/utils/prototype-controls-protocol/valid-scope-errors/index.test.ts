import { expect, it } from "vitest"

import { validControlsScopeErrors } from "."
import { validControlsState } from "../valid-state"

it("accepts bounded named failures and remains compatible with states without them", () => {
  const scopeErrors = [{ scope: "brokenPage", error: "Invalid declaration." }]
  const state = { runtimeAvailable: true, status: "invalid-config", scopes: [] }
  expect(validControlsScopeErrors(scopeErrors)).toBe(true)
  expect(validControlsState(state)).toBe(true)
  expect(validControlsState({ ...state, scopeErrors })).toBe(true)
  expect(validControlsScopeErrors([{ scope: "s".repeat(64), error: "e".repeat(500) }])).toBe(true)
  expect(validControlsScopeErrors(Array.from({ length: 100 }, () => scopeErrors[0]))).toBe(true)
})

it.each([
  null,
  {},
  [null],
  [{ scope: "brokenPage", error: 1 }],
  [{ scope: 1, error: "Invalid declaration." }],
  [{ scope: "", error: "Invalid declaration." }],
  [{ scope: "brokenPage", error: "" }],
  [{ scope: "s".repeat(65), error: "Invalid declaration." }],
  [{ scope: "brokenPage", error: "e".repeat(501) }],
  Array.from({ length: 101 }, () => ({ scope: "brokenPage", error: "Invalid declaration." })),
])("rejects malformed or oversized failure reports (%j)", (scopeErrors) => {
  expect(validControlsScopeErrors(scopeErrors)).toBe(false)
  expect(
    validControlsState({
      runtimeAvailable: true,
      status: "invalid-config",
      scopes: [],
      scopeErrors,
    }),
  ).toBe(false)
})
