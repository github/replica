import { XIcon } from "@primer/octicons-react"
import { Button, Heading } from "@primer/react-brand"
import { useCallback, useEffect, useId, useRef, useState } from "react"

import { ReviewThreadReplyForm } from "@features/review-thread-reply-form"
import { ReviewThreadMessage } from "@features/review-thread-message"
import { HubAlert } from "@components/hub-alert"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { ReviewConversationFrame } from "@components/review-conversation-frame"
import { useEmojiBurst } from "@hooks/use-emoji-burst"
import { useReviewCardPosition } from "@hooks/use-review-card-position"
import { useReviewThreadConversation } from "@hooks/use-review-thread-conversation"

import type { ReviewThreadConversationProps } from "./types"

import "./styles.css"

function updateMenuRoom(button: HTMLElement) {
  const menu = button.closest<HTMLElement>('[data-testid="ActionMenu"]')
  if (!menu) return

  const bounds = button.getBoundingClientRect()
  const shell = button.closest(".review-shell")?.getBoundingClientRect()
  const top = Math.max(0, shell?.top ?? 0)
  const bottom = Math.min(window.innerHeight, shell?.bottom ?? window.innerHeight)
  // Brand's anchor offset and small-menu margin each add 4px.
  const menuSpacing = 8
  menu.style.setProperty(
    "--review-thread-menu-room-top",
    `${Math.max(0, bounds.top - top - menuSpacing)}px`,
  )
  menu.style.setProperty(
    "--review-thread-menu-room-bottom",
    `${Math.max(0, bottom - bounds.bottom - menuSpacing)}px`,
  )
}

export function ReviewThreadConversation({
  thread,
  anchorPoint,
  bodyMaximumBytes,
  mutation,
  copy,
  onClose,
  onDraftStateChange,
  onReply,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
  onAddReaction,
  onRemoveReaction,
  onMarkRead,
  onMarkUnread,
}: ReviewThreadConversationProps) {
  const headingId = useId()
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const messagesScrollTopRef = useRef(0)
  const openedActivityVersionRef = useRef(thread.root.activityVersion)
  const attemptedReadVersionRef = useRef<number | null>(null)
  const readPendingRef = useRef(false)
  const unreadPendingRef = useRef(false)
  const wasConfirmingDiscardRef = useRef(false)
  const [readFailed, setReadFailed] = useState(false)
  const [readPending, setReadPending] = useState(false)
  const [unreadFailed, setUnreadFailed] = useState(false)
  const [unreadPending, setUnreadPending] = useState(false)
  const { burst, canvas } = useEmojiBurst()
  const conversation = useReviewThreadConversation({
    thread,
    bodyMaximumBytes,
    mutation,
    onClose,
    onDraftStateChange,
    onReply,
    onEdit,
    onDelete,
    onResolve,
    onReopen,
  })
  const { state, actions } = conversation
  const fallbackPoint = { x: 12, y: 12 }
  const comments = [thread.root, ...thread.replies]
  const { cardRef, position } = useReviewCardPosition({
    anchorPoint: anchorPoint ?? fallbackPoint,
    ...(anchorPoint
      ? {
          anchorSelector: `[data-review-thread-id="${thread.root.id}"]`,
          anchorRectangle: {
            x: anchorPoint.x - 16,
            y: anchorPoint.y - 16,
            width: 32,
            height: 32,
          },
        }
      : {}),
    layoutKey: [
      state.confirmingDiscard,
      state.confirmingEditDiscard,
      state.replyFailed,
      state.editFailed,
      state.deleteFailed,
      state.resolutionFailed,
      state.editingCommentId,
      state.confirmingDeleteId,
      state.resolved,
      readFailed,
      unreadFailed,
      thread.replies.length,
      thread.participants.length,
      comments.map((comment) => comment.reactions.length).join(","),
    ].join(":"),
  })
  const blockedLabel = state.replyBlocked
    ? thread.root.deletedAt
      ? copy.deletedReplyBlockedLabel
      : thread.root.resolvedBy
        ? copy.resolvedByLabel.replace(
            "%{author}",
            thread.root.resolvedBy.name || `@${thread.root.resolvedBy.login}`,
          )
        : copy.resolvedReplyBlockedLabel
    : null

  const focusCloseButton = useCallback(() => {
    // Brand Button does not forward the ref without a Tooltip wrapper.
    cardRef.current
      ?.querySelector<HTMLButtonElement>(".review-thread-conversation__close")
      ?.focus({ preventScroll: true })
  }, [cardRef])

  useEffect(() => {
    if (state.confirmingDiscard) {
      cardRef.current
        ?.querySelector<HTMLButtonElement>(".review-thread-conversation__footer button")
        ?.focus({ preventScroll: true })
    } else if (wasConfirmingDiscardRef.current) {
      const selector =
        state.editingCommentId === null
          ? ".review-thread-reply-form textarea"
          : ".review-thread-message__edit textarea"
      cardRef.current?.querySelector<HTMLTextAreaElement>(selector)?.focus({ preventScroll: true })
    }
    wasConfirmingDiscardRef.current = state.confirmingDiscard
  }, [cardRef, state.confirmingDiscard, state.editingCommentId])

  useEffect(() => {
    const activeElement = document.activeElement
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
    focusCloseButton()

    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
    }
  }, [focusCloseButton])

  useEffect(() => {
    const openedActivityVersion = openedActivityVersionRef.current
    if (!thread.unread || attemptedReadVersionRef.current === openedActivityVersion) {
      return
    }

    attemptedReadVersionRef.current = openedActivityVersion
    readPendingRef.current = true
    setReadPending(true)
    void onMarkRead(openedActivityVersion)
      .then((saved) => setReadFailed(!saved))
      .catch(() => setReadFailed(true))
      .finally(() => {
        readPendingRef.current = false
        setReadPending(false)
      })
  }, [onMarkRead, thread.unread])

  async function markUnread() {
    if (readPendingRef.current || unreadPendingRef.current || mutation !== null) return

    attemptedReadVersionRef.current = openedActivityVersionRef.current
    unreadPendingRef.current = true
    setUnreadPending(true)
    setUnreadFailed(false)
    try {
      const saved = await onMarkUnread()
      setUnreadFailed(!saved)
      if (saved) setReadFailed(false)
    } catch {
      setUnreadFailed(true)
    } finally {
      unreadPendingRef.current = false
      setUnreadPending(false)
    }
  }

  useEffect(() => {
    function dismiss() {
      if (state.confirmingDiscard) actions.keepDraft()
      else if (state.confirmingEditDiscard) actions.keepEdit()
      else actions.requestDismissal()
    }

    function handleEscape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        cardRef.current?.querySelector('[role="menu"]') ||
        (event.target instanceof Element &&
          event.target.closest('[role="menu"], [role="dialog"], dialog'))
      ) {
        return
      }

      event.preventDefault()
      dismiss()
    }

    function handlePreviewDismissal() {
      const active = document.activeElement
      if (
        cardRef.current?.querySelector('[role="menu"]') ||
        (active instanceof Element &&
          (active.closest('[role="menu"]') ||
            (active.closest('[role="dialog"], dialog') && !cardRef.current?.contains(active))))
      ) {
        return
      }
      dismiss()
    }

    document.addEventListener("keydown", handleEscape)
    window.addEventListener("replica:review-dismiss", handlePreviewDismissal)
    return () => {
      document.removeEventListener("keydown", handleEscape)
      window.removeEventListener("replica:review-dismiss", handlePreviewDismissal)
    }
  }, [actions, cardRef, state.confirmingDiscard, state.confirmingEditDiscard])

  return (
    <ReviewConversationFrame
      ref={cardRef}
      aria-labelledby={headingId}
      anchored={Boolean(anchorPoint)}
      position={position}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          (event.target instanceof Element && event.target.closest('[role="menu"]'))
        ) {
          return
        }

        event.preventDefault()
        if (state.confirmingDiscard) actions.keepDraft()
        else if (state.confirmingEditDiscard) actions.keepEdit()
        else actions.requestDismissal()
      }}
    >
      <div className="review-thread-conversation__layout">
        <header className="review-thread-conversation__header">
          <Heading as="h2" size="6" id={headingId}>
            {copy.threadHeading}
          </Heading>

          {thread.root.buildNumber !== null ? (
            <Button
              size="small"
              disabled={state.draftActive || mutation !== null}
              aria-busy={
                mutation !== null &&
                "commentId" in mutation &&
                mutation.commentId === thread.root.id &&
                (mutation.kind === "resolve" || mutation.kind === "reopen")
              }
              onClick={() => {
                void actions.changeResolution()
              }}
            >
              {state.resolved ? copy.reopenLabel : copy.resolveLabel}
            </Button>
          ) : null}
          {mutation &&
          "commentId" in mutation &&
          mutation.commentId === thread.root.id &&
          (mutation.kind === "resolve" || mutation.kind === "reopen") ? (
            <HubVisuallyHidden role="status">
              {state.resolved ? copy.reopeningLabel : copy.resolvingLabel}
            </HubVisuallyHidden>
          ) : null}

          <HubIconButton
            icon={XIcon}
            aria-label={copy.backToCommentsLabel}
            title={copy.backToCommentsLabel}
            variant="invisible"
            className="review-thread-conversation__close"
            onClick={actions.requestDismissal}
          />
        </header>

        {state.resolutionFailed ? (
          <HubAlert
            variant="critical"
            title={copy.resolutionErrorLabel}
            className="review-thread-conversation__banner"
          />
        ) : null}

        {readFailed ? (
          <HubAlert
            variant="critical"
            title={copy.readErrorLabel}
            className="review-thread-conversation__banner"
          />
        ) : null}

        {unreadFailed ? (
          <HubAlert
            variant="critical"
            title={copy.markUnreadErrorLabel}
            className="review-thread-conversation__banner"
          />
        ) : null}

        <div
          className="review-thread-conversation__messages"
          onClickCapture={(event) => {
            if (!(event.target instanceof Element)) return
            const button = event.target.closest<HTMLElement>(
              'button[data-testid="ActionMenu-button"]',
            )
            if (button && event.currentTarget.contains(button)) {
              messagesScrollTopRef.current = event.currentTarget.scrollTop
              updateMenuRoom(button)
            }
          }}
          onScroll={(event) => {
            const scrollTop = event.currentTarget.scrollTop
            const delta = scrollTop - messagesScrollTopRef.current
            messagesScrollTopRef.current = scrollTop
            if (delta === 0) return

            const paneBounds = event.currentTarget.getBoundingClientRect()
            event.currentTarget.querySelectorAll<HTMLElement>('[role="menu"]').forEach((menu) => {
              const button = menu
                .closest('[data-testid="ActionMenu"]')
                ?.querySelector<HTMLElement>('button[data-testid="ActionMenu-button"]')
              if (!button) return

              const buttonBounds = button.getBoundingClientRect()
              if (
                paneBounds.height > 0 &&
                (buttonBounds.bottom <= paneBounds.top || buttonBounds.top >= paneBounds.bottom)
              ) {
                const menuHadFocus = menu.contains(document.activeElement)
                button.click()
                if (menuHadFocus) focusCloseButton()
                return
              }

              const top = Number.parseFloat(menu.style.top)
              if (Number.isFinite(top)) menu.style.top = `${top - delta}px`
              updateMenuRoom(button)
            })
          }}
        >
          {comments.map((comment) => (
            <ReviewThreadMessage
              key={comment.id}
              comment={comment}
              mutation={mutation}
              copy={copy}
              editing={state.editingCommentId === comment.id}
              editDraft={state.editingCommentId === comment.id ? state.editDraft : ""}
              editBodyTooLong={state.editingCommentId === comment.id && state.editBodyTooLong}
              editFailed={state.editingCommentId === comment.id && state.editFailed}
              confirmingEditDiscard={
                state.editingCommentId === comment.id && state.confirmingEditDiscard
              }
              saving={mutation?.kind === "edit" && mutation.commentId === comment.id}
              confirmingDelete={state.confirmingDeleteId === comment.id}
              deleting={mutation?.kind === "delete" && mutation.commentId === comment.id}
              deleteFailed={state.confirmingDeleteId === comment.id && state.deleteFailed}
              actionsDisabled={
                (mutation !== null &&
                  mutation.kind !== "add-reaction" &&
                  mutation.kind !== "remove-reaction") ||
                state.confirmingDiscard ||
                state.confirmingDeleteId !== null ||
                state.replyDraft.trim() !== "" ||
                (state.editingCommentId !== null && state.editingCommentId !== comment.id)
              }
              onStartEdit={() => actions.startEdit(comment)}
              onEditDraftChange={actions.changeEditDraft}
              onSaveEdit={() => {
                void actions.saveEdit(comment.id)
              }}
              onCancelEdit={actions.cancelEdit}
              onKeepEdit={actions.keepEdit}
              onDiscardEdit={actions.discardEdit}
              onRequestDelete={() => actions.requestDelete(comment.id)}
              onCancelDelete={actions.cancelDelete}
              onDelete={() => {
                void actions.deleteComment(comment.id)
              }}
              onAddReaction={(content) => onAddReaction(comment.id, content)}
              onRemoveReaction={(content) => onRemoveReaction(comment.id, content)}
              onBurstReaction={burst}
              onMarkUnread={
                comment.kind === "root" && thread.root.buildNumber !== null
                  ? () => void markUnread()
                  : undefined
              }
              markUnreadDisabled={readPending || unreadPending || mutation !== null}
            />
          ))}
        </div>

        {thread.root.buildNumber !== null || state.confirmingDiscard ? (
          <div
            className={`review-thread-conversation__footer${
              blockedLabel && !state.confirmingDiscard
                ? " review-thread-conversation__footer--blocked"
                : ""
            }`}
          >
            <ReviewThreadReplyForm
              blockedLabel={blockedLabel}
              confirmingDiscard={state.confirmingDiscard}
              replyDraft={state.replyDraft}
              replyBodyTooLong={state.replyBodyTooLong}
              replyFailed={state.replyFailed}
              replyDisabled={mutation !== null || state.editingCommentId !== null}
              replying={mutation?.kind === "reply" && mutation.commentId === thread.root.id}
              copy={copy}
              onKeepDraft={actions.keepDraft}
              onDiscardDraft={actions.discardAndClose}
              onSubmit={() => {
                void actions.submitReply()
              }}
              onDraftChange={actions.changeReplyDraft}
            />
          </div>
        ) : null}
      </div>
      {canvas}
    </ReviewConversationFrame>
  )
}
