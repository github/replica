import { useState } from "react"
import type { PropsWithChildren, ReactNode } from "react"

import "./styles.css"

/** Shares the existing sidebar geometry and narrow-screen collapse across Hub scopes. */
export function WorkspaceFrame({
  children,
  navigation,
  defaultNavigationCollapsed = false,
}: PropsWithChildren<{
  navigation: (collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void) => ReactNode
  defaultNavigationCollapsed?: boolean
}>) {
  const [navigationCollapsed, setNavigationCollapsed] = useState(
    () =>
      defaultNavigationCollapsed ||
      (typeof window !== "undefined" && window.matchMedia?.("(max-width: 48rem)").matches) ||
      false,
  )

  return (
    <main className="repository-workspace" data-navigation-collapsed={navigationCollapsed}>
      {navigation(navigationCollapsed, setNavigationCollapsed)}
      <div className="repository-workspace__content">{children}</div>
    </main>
  )
}
