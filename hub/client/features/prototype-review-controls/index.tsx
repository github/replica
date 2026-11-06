import { Button, Tooltip } from "@primer/react-brand"

import { HubCounter } from "@components/hub-counter"
import { ReviewCommentControl } from "@features/prototype-workspace-header/review-comment-control"

import type { PrototypeReviewControlsProps } from "./types"

import "../prototype-workspace-header-layout/styles.css"

export function PrototypeReviewControls({
  noBuild = false,
  ...reviewControls
}: PrototypeReviewControlsProps) {
  return (
    <div
      className="review-shell__comment-actions"
      role="group"
      aria-label={reviewControls.copy.heading}
    >
      <ReviewCommentControl {...reviewControls} />

      <Tooltip
        text={
          reviewControls.sidebarToggleBlocked
            ? reviewControls.copy.selectionBlockedLabel
            : `${reviewControls.copy.heading} (${reviewControls.copy.sidebarShortcutLabel})`
        }
        type="description"
      >
        <Button
          className="review-shell__comments-toggle"
          variant="secondary"
          size="small"
          aria-label={`${reviewControls.copy.heading}, ${reviewControls.commentCount}${reviewControls.hasUnreadComments ? `, ${reviewControls.copy.unreadLabel}` : ""}`}
          aria-expanded={reviewControls.sidebarOpen}
          aria-keyshortcuts="Shift+C"
          disabled={noBuild || reviewControls.sidebarToggleBlocked}
          onClick={reviewControls.onToggleSidebar}
        >
          <HubCounter>{reviewControls.commentCount}</HubCounter>
          {reviewControls.hasUnreadComments ? (
            <span className="review-shell__unread-badge" aria-hidden="true" />
          ) : null}
        </Button>
      </Tooltip>
    </div>
  )
}
