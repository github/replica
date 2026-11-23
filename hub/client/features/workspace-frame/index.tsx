import { createContext, useContext, useLayoutEffect, useRef, useState } from "react"
import type { PropsWithChildren, ReactNode } from "react"

import "./styles.css"

const WorkspaceFrameContext = createContext(false)

type FrameProps = PropsWithChildren<{
  navigation: (collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void) => ReactNode
  defaultNavigationCollapsed?: boolean
  contentResetKey?: string
}>

/** Shares navigation layout and narrow-screen collapse across Hub scopes. */
export function WorkspaceFrame(props: FrameProps) {
  return useContext(WorkspaceFrameContext) ? props.children : <StandaloneFrame {...props} />
}

function StandaloneFrame({
  children,
  navigation,
  defaultNavigationCollapsed = false,
  contentResetKey,
}: FrameProps) {
  const [navigationCollapsed, setNavigationCollapsed] = useState(
    () =>
      defaultNavigationCollapsed ||
      (typeof window !== "undefined" && window.matchMedia?.("(max-width: 48rem)").matches) ||
      false,
  )

  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (contentResetKey !== undefined && content.current) {
      content.current.scrollTop = 0
      content.current.scrollLeft = 0
    }
  }, [contentResetKey])

  return (
    <main className="repository-workspace" data-navigation-collapsed={navigationCollapsed}>
      {navigation(navigationCollapsed, setNavigationCollapsed)}
      <div className="repository-workspace__content" ref={content}>
        <WorkspaceFrameContext value={true}>{children}</WorkspaceFrameContext>
      </div>
    </main>
  )
}
