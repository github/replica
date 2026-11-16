import { defaultTheme, extendTheme } from "@inkjs/ui"

export const terminalColors = {
  accent: "magenta",
  error: "red",
  warning: "yellow",
  info: "cyan",
  success: "green",
} as const

export const terminalTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: { styles: { frame: () => ({ color: terminalColors.accent }) } },
    MultiSelect: {
      styles: {
        option: (props: { isFocused: boolean }) => ({
          ...defaultTheme.components.MultiSelect?.styles?.option?.(props),
          flexDirection: "row-reverse",
          justifyContent: "flex-end",
        }),
      },
    },
  },
})
