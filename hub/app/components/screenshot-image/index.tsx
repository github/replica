import type { ComponentProps } from "react"

import { useOptionalHubTheme } from "@hooks/use-hub-theme"

/** Selects a retained screenshot using Hub's resolved theme, including explicit overrides. */
export function ScreenshotImage({
  src,
  darkSrc,
  ...props
}: ComponentProps<"img"> & { alt: string; darkSrc?: string }) {
  const theme = useOptionalHubTheme()
  return <img {...props} src={theme?.resolvedColorMode === "dark" && darkSrc ? darkSrc : src} />
}
