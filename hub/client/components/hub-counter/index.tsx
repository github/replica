import type { ComponentPropsWithRef } from "react"

import "./styles.css"

type Props = Omit<ComponentPropsWithRef<"span">, "children"> & {
  children: number | string
}

export function HubCounter({ children, className, ...props }: Props) {
  return (
    <span {...props} className={`hub-counter${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  )
}
