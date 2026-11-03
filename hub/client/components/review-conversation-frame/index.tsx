import type { ComponentPropsWithRef, CSSProperties } from "react"

import type { ReviewCardPosition } from "@hooks/use-review-card-position/types"

import "./styles.css"

export function ReviewConversationFrame({
  position,
  anchored,
  className,
  style,
  ...props
}: ComponentPropsWithRef<"section"> & {
  position: ReviewCardPosition
  anchored: boolean
}) {
  return (
    <section
      {...props}
      role="dialog"
      className={`review-thread-conversation review-thread-conversation--${anchored ? "anchored" : "docked"}${className ? ` ${className}` : ""}`}
      style={
        {
          "--review-thread-left": `${position.left}px`,
          "--review-thread-top": `${position.top}px`,
          ...style,
        } as CSSProperties
      }
    />
  )
}
