import type { ComponentPropsWithRef } from "react"

import "./styles.css"

export function HubVisuallyHidden({ className, ...props }: ComponentPropsWithRef<"span">) {
  return <span {...props} className={`hub-visually-hidden${className ? ` ${className}` : ""}`} />
}
