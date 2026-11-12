import { ReviewCommentComposer } from "@features/review-comment-composer"
import { ReviewThreadConversation } from "@features/review-thread-conversation"

import type { CanvasReviewOverlaysProps } from "./types"
import "../prototype-canvas-hub-panel/styles.css"

/** Presents review feedback and drafts without owning transport or authorization. */
export function CanvasReviewOverlays({
  selectionNotice,
  rateLimitNotice,
  composer,
  conversation,
}: CanvasReviewOverlaysProps) {
  return (
    <>
      {selectionNotice || rateLimitNotice ? (
        <div className="canvas-selection-notice" role="alert">
          {selectionNotice ? <div>{selectionNotice}</div> : null}
          {rateLimitNotice ? <div>{rateLimitNotice}</div> : null}
        </div>
      ) : null}
      {composer ? (
        <div className="canvas-composer-shell">
          <ReviewCommentComposer {...composer} />
        </div>
      ) : null}
      {conversation ? (
        <div className="canvas-conversation-shell">
          <ReviewThreadConversation key={conversation.thread.root.id} {...conversation} />
        </div>
      ) : null}
    </>
  )
}
