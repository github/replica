import { ReviewCommentComposer } from "@features/review-comment-composer"
import { ReviewThreadConversation } from "@features/review-thread-conversation"
import { useReviewError } from "@hooks/use-review-error"

import type { CanvasReviewOverlaysProps } from "./types"
import "../prototype-canvas-hub-panel/styles.css"

/** Presents review feedback and drafts without owning transport or authorization. */
export function CanvasReviewOverlays({
  selectionNotice,
  rateLimitNotice,
  composer,
  conversation,
}: CanvasReviewOverlaysProps) {
  const showSelectionNotice = useReviewError(selectionNotice)
  const showRateLimitNotice = useReviewError(rateLimitNotice)

  return (
    <>
      {showSelectionNotice || showRateLimitNotice ? (
        <div className="canvas-selection-notice" role="alert">
          {showSelectionNotice ? <div>{selectionNotice}</div> : null}
          {showRateLimitNotice ? <div>{rateLimitNotice}</div> : null}
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
