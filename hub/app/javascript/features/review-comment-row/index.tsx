import { Label } from "@primer/react-brand/esm"
import { useId } from "react"

import { HubUserAvatar } from "@components/hub-user-avatar"
import { ReviewRelativeTime } from "@features/review-relative-time"

import type { ReviewCommentRowProps } from "./types"

import "./styles.css"

export function ReviewCommentRow({
  thread,
  currentBuildNumber,
  resolution,
  anchorStatusLabel,
  selected,
  selectionBlocked,
  copy,
  onSelect,
  buildHref,
}: ReviewCommentRowProps) {
  const id = useId()
  const { root } = thread
  const author = root.author.name || `@${root.author.login}`
  const selectionDisabled = selectionBlocked && !selected
  const buildLabel = copy.buildLabel.replace("%{number}", root.buildNumber?.toString() ?? "")
  const showBuildLink =
    root.buildNumber !== null && root.buildPath !== null && root.buildNumber !== currentBuildNumber
  const replyCountLabel =
    thread.replies.length === 1
      ? copy.replyCountOneLabel
      : copy.replyCountOtherLabel.replace("%{count}", thread.replies.length.toString())
  let statusLabel: string | null = copy.missingAnchorLabel
  if (root.resolvedAt) {
    statusLabel = copy.resolvedLabel
  } else if (anchorStatusLabel !== undefined) {
    statusLabel = anchorStatusLabel
  } else if (!resolution) {
    statusLabel = null
  } else if (resolution.status === "resolved") {
    statusLabel = null
  } else if (resolution.status === "moved") {
    statusLabel = copy.movedAnchorLabel
  } else if (resolution.status === "changed") {
    statusLabel = copy.changedAnchorLabel
  } else if (resolution.status === "route-mismatch") {
    statusLabel = copy.routeMismatchLabel
  }

  return (
    <article
      className={`review-comment-row${selected ? " review-comment-row--selected" : ""}${thread.unread ? " review-comment-row--unread" : ""}`}
      onClick={(event) => {
        if (selectionDisabled || (event.target instanceof Element && event.target.closest("a")))
          return

        onSelect(thread)
      }}
    >
      <div className="review-comment-row__layout">
        <div className="review-comment-row__content">
          <div className="review-comment-row__copy">
            <div className="review-comment-row__metadata">
              <span className="review-comment-row__author-and-build">
                <HubUserAvatar
                  src={root.author.avatarUrl}
                  size={20}
                  className="review-comment-row__avatar"
                />
                <span id={`${id}-author`} className="review-comment-row__author">
                  {author}
                </span>

                {showBuildLink ? (
                  <span className="review-comment-row__build">
                    (
                    <a
                      href={buildHref || root.buildPath || undefined}
                      target={buildHref ? "_blank" : undefined}
                      rel={buildHref ? "noopener noreferrer" : undefined}
                    >
                      {buildLabel}
                    </a>
                    )
                  </span>
                ) : null}
              </span>

              <ReviewRelativeTime value={thread.lastActivityAt} />
            </div>

            <button
              type="button"
              className="review-comment-row__button"
              aria-labelledby={`${id}-author ${id}-body${thread.unread ? ` ${id}-unread` : ""}`}
              aria-pressed={selected}
              disabled={selectionDisabled}
              title={selectionDisabled ? copy.selectionBlockedLabel : undefined}
            >
              <span className="review-comment-row__body-container">
                {thread.unread ? (
                  <span
                    role="img"
                    id={`${id}-unread`}
                    aria-label={copy.unreadLabel}
                    title={copy.unreadLabel}
                    className="review-comment-row__unread"
                  />
                ) : null}
                <span id={`${id}-body`} className="review-comment-row__body">
                  {root.body ?? copy.deletedCommentLabel}
                </span>
              </span>
            </button>
          </div>

          {statusLabel || thread.replies.length > 0 ? (
            <div className="review-comment-row__context">
              {thread.replies.length > 0 ? (
                <span className="review-comment-row__replies">{replyCountLabel}</span>
              ) : null}

              {statusLabel ? (
                <Label size="small" className="review-comment-row__status">
                  {statusLabel}
                </Label>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
