import { ThemeProvider as BrandThemeProvider } from "@primer/react-brand"
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from "react"
import type { PropsWithChildren } from "react"

export type HubColorMode = "auto" | "light" | "dark"

export type HubResolvedColorMode = Exclude<HubColorMode, "auto">

const HubThemeContext = createContext<{
  colorMode: HubColorMode
  resolvedColorMode: HubResolvedColorMode
  setColorMode: (mode: HubColorMode) => void
} | null>(null)

function subscribeToSystemTheme(onChange: () => void) {
  const preference = window.matchMedia("(prefers-color-scheme: dark)")
  preference.addEventListener("change", onChange)

  return () => preference.removeEventListener("change", onChange)
}

function systemIsDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function useHubTheme() {
  const theme = useContext(HubThemeContext)
  if (!theme) throw new Error("useHubTheme() requires HubThemeProvider")

  return theme
}

export function useOptionalHubTheme() {
  return useContext(HubThemeContext)
}

export function HubThemeProvider({
  children,
  colorMode = "auto",
}: PropsWithChildren<{ colorMode?: HubColorMode }>) {
  const [mode, setMode] = useState<HubColorMode>(colorMode)
  const [previousColorMode, setPreviousColorMode] = useState(colorMode)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemIsDark, () => false)

  if (colorMode !== previousColorMode) {
    setPreviousColorMode(colorMode)
    setMode(colorMode)
  }

  const resolvedColorMode: HubResolvedColorMode =
    mode === "auto" ? (systemDark ? "dark" : "light") : mode

  useLayoutEffect(() => {
    const root = document.documentElement
    const previousMode = root.getAttribute("data-color-mode")
    root.setAttribute("data-color-mode", resolvedColorMode)

    return () => {
      if (previousMode === null) root.removeAttribute("data-color-mode")
      else root.setAttribute("data-color-mode", previousMode)
    }
  }, [resolvedColorMode])

  return (
    <BrandThemeProvider className="hub-theme" colorMode={resolvedColorMode}>
      <HubThemeContext.Provider
        value={{ colorMode: mode, resolvedColorMode, setColorMode: setMode }}
      >
        {children}
      </HubThemeContext.Provider>
    </BrandThemeProvider>
  )
}
