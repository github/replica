import { homedir } from "node:os"
import { join, resolve } from "node:path"

import { InputValidationError } from "../config/fields/index.ts"

export function normalizeInstallerPath(input: unknown): string {
  if (typeof input !== "string" || /[\u0000-\u001f\u007f]/.test(input))
    throw new InputValidationError("Enter a file path without control characters.")
  let value = input.trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1)
  if (process.platform !== "win32") value = value.replace(/\\([ ()'"\[\]#&;])/g, "$1")
  if (!value) throw new InputValidationError("Enter a file path.")
  if (value === "~") value = homedir()
  else if (value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\")))
    value = join(homedir(), value.slice(2))
  return resolve(value)
}
