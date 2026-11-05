import { configurationFields, InputValidationError } from "../config/fields/index.ts"
import type { InstallerUI } from "../types.ts"

export async function promptForField(
  ui: Pick<InstallerUI, "field" | "text" | "status">,
  key: keyof typeof configurationFields,
  initial = "",
): Promise<string> {
  const field = configurationFields[key]
  if (ui.field) return field.parse(await ui.field(field, initial))
  const text = ui.text
  if (!text) throw new Error("This interface cannot edit configuration fields.")
  let current = initial
  ui.status(field.help)
  while (true) {
    const value = await text.call(ui, field.label, current)
    try {
      return field.parse(value)
    } catch (error) {
      if (!(error instanceof InputValidationError)) throw error
      ui.status(`Invalid value. ${error.message}`)
      current = key === "npmRegistry" || /[\u0000-\u001f\u007f]/.test(value) ? "" : value
    }
  }
}
