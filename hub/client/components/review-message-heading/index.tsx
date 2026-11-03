import type { ReactNode } from "react"

import "./styles.css"

export function ReviewMessageHeading({
  visual,
  author,
  metadata,
  children,
}: {
  visual: ReactNode
  author: ReactNode
  metadata?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="review-thread-message__header">
      {visual}
      <span className="review-thread-message__byline">
        <strong className="review-thread-message__identity">{author}</strong>
        {metadata}
      </span>
      {children}
    </div>
  )
}
