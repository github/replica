import type { FieldDefinition } from "../../types.ts"

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InputValidationError"
  }
}

function readText(value: unknown, label: string, pattern: RegExp, help: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !pattern.test(value)
  ) {
    throw new InputValidationError(`${label}: ${help}`)
  }
  return value
}

function textField(
  id: string,
  label: string,
  help: string,
  pattern: RegExp,
  minimum = 1,
  maximum?: number,
): FieldDefinition {
  const parse = (value: unknown) => {
    if (typeof value === "string" && value.length < minimum)
      throw new InputValidationError(
        `${label} needs at least ${minimum} characters (${value.length} entered).`,
      )
    if (typeof value === "string" && maximum !== undefined && value.length > maximum)
      throw new InputValidationError(
        `${label} allows at most ${maximum} characters (${value.length} entered).`,
      )
    return readText(value, label, pattern, help)
  }
  return {
    id,
    label,
    help,
    parse,
    editingError(value) {
      if (!value) return undefined
      let message = help
      for (const candidate of [value, value.padEnd(minimum, "a"), `${value}a`]) {
        try {
          parse(candidate)
          return undefined
        } catch (error) {
          if (!(error instanceof InputValidationError)) throw error
          if (candidate === value) message = error.message
        }
      }
      return message
    },
  }
}

const registryHelp =
  "Use the HTTPS registry URL supplied by your package-feed administrator, without a username, password, query, or fragment."

export const configurationFields = {
  name: textField(
    "name",
    "Installation name",
    "Use 4-20 lowercase letters, digits, or single hyphens. Start with a letter, end with a letter or digit, and avoid consecutive hyphens. Example: team-hub.",
    /^(?!.*--)[a-z][a-z0-9-]{2,18}[a-z0-9]$/,
    4,
    20,
  ),
  owner: textField(
    "owner",
    "Owning team or person (Azure resource tag)",
    "Use a stable ownership label such as platform-team (1-128 characters, without leading or trailing whitespace). This does not assign billing or permissions.",
    /^\S[^\r\n]{0,126}\S$|^\S$/,
    1,
    128,
  ),
  resourceGroup: textField(
    "resourceGroup",
    "Dedicated application resource group",
    "Accept the suggested name or enter a dedicated group name (1-90 letters, digits, underscores, hyphens, periods, or parentheses; start with a letter or digit and do not end with a period). Existing unrelated groups cannot be adopted.",
    /^[a-zA-Z0-9](?:[a-zA-Z0-9_.()-]{0,88}[a-zA-Z0-9_()-])?$/,
    1,
    90,
  ),
  npmRegistry: {
    id: "npmRegistry",
    label: "HTTPS npm registry URL",
    help: registryHelp,
    clearRejected: true,
    editingError(value: string) {
      if (!value || "https://".startsWith(value)) return undefined
      if (!value.startsWith("https://")) return registryHelp
      if (URL.canParse(value)) {
        const url = new URL(value)
        if (url.username || url.password || url.search || url.hash) return registryHelp
      }
      return undefined
    },
    parse(input: unknown): string {
      const value = readText(input, "npm registry URL", /.+/, registryHelp)
      if (!URL.canParse(value)) throw new InputValidationError(registryHelp)
      const url = new URL(value)
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new InputValidationError(registryHelp)
      }
      return url.href.endsWith("/") ? url.href : `${url.href}/`
    },
  },
}
