import type { PropsWithChildren } from "react"

import "./styles.css"

export function PrototypeWorkspaceBody({ children }: PropsWithChildren) {
  return <div className="prototype-workspace__body">{children}</div>
}
