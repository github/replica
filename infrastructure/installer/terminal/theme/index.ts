import { defaultTheme, extendTheme } from "@inkjs/ui"

export const terminalColors = {
  accent: "magenta",
  error: "red",
  warning: "yellow",
  info: "cyan",
  success: "green",
} as const

export const terminalTheme = extendTheme(defaultTheme, {
  components: { Spinner: { styles: { frame: () => ({ color: terminalColors.accent }) } } },
})
