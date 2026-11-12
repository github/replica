import type { Control } from "@utils/prototype-controls/controls.mjs"

export function numericInputWidth(control: Extract<Control, { type: "number" | "slider" }>) {
  const step = control.step ?? 1
  const precision = Math.max(
    ...[control.min, control.max, step].map((value) => {
      const [coefficient = "", exponent = "0"] = String(value).split("e")
      return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent))
    }),
  )
  const characters = Math.max(
    ...[control.min, control.max].map((bound) =>
      precision <= 100 ? bound.toFixed(precision).length : String(bound).length,
    ),
    String(control.default).length,
    String(step).length,
  )
  return control.type === "slider"
    ? `calc(${characters}ch + var(--hub-space-8) * 2)`
    : `calc(${characters}ch + var(--hub-space-8) * 2 + 1.25rem)`
}
