import type { Declaration, Values } from "@utils/prototype-controls/controls.mjs"

export function validControlsValues(value: unknown): value is Partial<Values<Declaration>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([id, entry]) =>
        /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(id) &&
        (typeof entry === "string" ||
          typeof entry === "boolean" ||
          (typeof entry === "number" && Number.isFinite(entry)) ||
          (Array.isArray(entry) &&
            entry.length <= 100 &&
            entry.every((option: unknown) => typeof option === "string"))),
    )
  )
}
