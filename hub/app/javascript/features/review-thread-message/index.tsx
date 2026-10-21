import { DotFillIcon, KebabHorizontalIcon, PencilIcon, TrashIcon } from "@primer/octicons-react"
import { ActionMenu, Button, Tooltip } from "@primer/react-brand"
import { useEffect, useId, useRef, useState } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { MentionInput } from "@components/mention-input"
import { MentionText } from "@components/mention-text"
import { HubUserAvatar } from "@components/hub-user-avatar"
import { ReviewConfirmationPanel } from "@features/review-confirmation-panel"
import { ReviewCommentReactions } from "@features/review-comment-reactions"
import { ReviewRelativeTime } from "@features/review-relative-time"

import type { ReviewThreadMessageProps } from "./types"

import "./styles.css"

export function ReviewThreadMessage({
  comment,
  mutation,
  copy,
  editing,
  editDraft,
  editBodyTooLong,
  editFailed,
  confirmingEditDiscard,
  saving,
  confirmingDelete,
  deleting,
  deleteFailed,
  actionsDisabled,
  onStartEdit,
  onEditDraftChange,
  onSaveEdit,
  onCancelEdit,
  onKeepEdit,
  onDiscardEdit,
  onRequestDelete,
  onCancelDelete,
  onDelete,
  onAddReaction,
  onRemoveReaction,
  onBurstReaction,
  onMarkUnread,
  markUnreadDisabled = false,
}: ReviewThreadMessageProps) {
  const actionTooltipId = useId()
  const editFormRef = useRef<HTMLFormElement>(null)
  const wasConfirmingEditDiscard = useRef(false)
  const [menuSide, setMenuSide] = useState<"outside-bottom" | "outside-top">("outside-bottom")
  const author = comment.author.name || `@${comment.author.login}`
  const actionLabel = copy.commentActionsLabel.replace("%{author}", `@${comment.author.login}`)
  const menuDisabled = actionsDisabled && (!onMarkUnread || markUnreadDisabled)
  const canEdit = Boolean(comment.body && comment.viewerCanEdit)
  const canDelete = Boolean(comment.body && comment.viewerCanDelete)
  useEffect(() => {
    if (confirmingEditDiscard) {
      editFormRef.current
        ?.querySelector<HTMLButtonElement>(".review-confirmation-panel button")
        ?.focus({ preventScroll: true })
    } else if (wasConfirmingEditDiscard.current) {
      editFormRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({
        preventScroll: true,
      })
    }
    wasConfirmingEditDiscard.current = confirmingEditDiscard
  }, [confirmingEditDiscard])

  return (
    <article className="review-thread-message" data-review-message-id={comment.id}>
      <div className="review-thread-message__header">
        <HubUserAvatar src={comment.author.avatarUrl} size={28} />

        <span className="review-thread-message__byline">
          <strong className="review-thread-message__identity">{author}</strong>
          <ReviewRelativeTime value={comment.createdAt} />
          {comment.editedAt ? <span>{copy.editedLabel}</span> : null}
        </span>

        {onMarkUnread || canEdit || canDelete ? (
          menuDisabled ? (
            <div title={actionLabel}>
              <ActionMenu selectionVariant="none" size="small" menuAlignment="end" disabled>
                <ActionMenu.Button
                  className="review-thread-message__menu-trigger"
                  variant="subtle"
                  aria-label={actionLabel}
                  aria-describedby={actionTooltipId}
                  leadingVisual={<KebabHorizontalIcon size={16} />}
                >
                  {""}
                </ActionMenu.Button>
              </ActionMenu>
              <HubVisuallyHidden id={actionTooltipId}>{actionLabel}</HubVisuallyHidden>
            </div>
          ) : (
            <Tooltip id={actionTooltipId} text={actionLabel} type="description">
              <div>
                <ActionMenu
                  selectionVariant="none"
                  size="small"
                  menuAlignment="end"
                  menuSide={menuSide}
                >
                  <ActionMenu.Button
                    className="review-thread-message__menu-trigger"
                    variant="subtle"
                    aria-label={actionLabel}
                    aria-describedby={actionTooltipId}
                    leadingVisual={<KebabHorizontalIcon size={16} />}
                    onClick={(event) => {
                      const bounds = event.currentTarget.getBoundingClientRect()
                      const shell = event.currentTarget
                        .closest(".review-shell")
                        ?.getBoundingClientRect()
                      const spaceBelow =
                        Math.min(window.innerHeight, shell?.bottom ?? Infinity) - bounds.bottom
                      const spaceAbove = bounds.top - Math.max(0, shell?.top ?? 0)
                      setMenuSide(
                        spaceBelow < (onMarkUnread ? 128 : 88) && spaceAbove > spaceBelow
                          ? "outside-top"
                          : "outside-bottom",
                      )
                    }}
                  >
                    {""}
                  </ActionMenu.Button>
                  <ActionMenu.Overlay aria-label={actionLabel}>
                    {onMarkUnread ? (
                      <ActionMenu.Item
                        value="mark-unread"
                        disabled={markUnreadDisabled}
                        leadingVisual={<DotFillIcon size={16} />}
                        onClick={() => {
                          if (!markUnreadDisabled) onMarkUnread()
                        }}
                        onKeyDown={(event) => {
                          if (!markUnreadDisabled && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault()
                            onMarkUnread()
                          }
                        }}
                      >
                        {copy.markUnreadLabel}
                      </ActionMenu.Item>
                    ) : null}
                    {canEdit ? (
                      <ActionMenu.Item
                        value="edit"
                        disabled={actionsDisabled}
                        leadingVisual={<PencilIcon size={16} />}
                        onClick={onStartEdit}
                        onKeyDown={(event) => {
                          if (!actionsDisabled && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault()
                            onStartEdit()
                          }
                        }}
                      >
                        {copy.editLabel}
                      </ActionMenu.Item>
                    ) : null}
                    {canDelete && (onMarkUnread || canEdit) ? (
                      <li role="separator" className="review-thread-message__menu-divider" />
                    ) : null}
                    {canDelete ? (
                      <ActionMenu.Item
                        value="delete"
                        disabled={actionsDisabled || mutation !== null}
                        className="review-thread-message__delete-item"
                        leadingVisual={<TrashIcon size={16} />}
                        onClick={onRequestDelete}
                        onKeyDown={(event) => {
                          if (
                            !actionsDisabled &&
                            mutation === null &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault()
                            onRequestDelete()
                          }
                        }}
                      >
                        {copy.deleteLabel}
                      </ActionMenu.Item>
                    ) : null}
                  </ActionMenu.Overlay>
                </ActionMenu>
              </div>
            </Tooltip>
          )
        ) : null}
      </div>

      {editing ? (
        <form
          ref={editFormRef}
          className="review-thread-message__edit"
          onSubmit={(event) => {
            event.preventDefault()
            if (!confirmingEditDiscard) onSaveEdit()
          }}
        >
          <MentionInput
            autoFocus
            aria-label={copy.editCommentLabel}
            value={editDraft}
            rows={3}
            onValueChange={onEditDraftChange}
          />

          {editBodyTooLong ? (
            <span role="alert" className="review-thread-message__error">
              {copy.bodyTooLongLabel}
            </span>
          ) : null}

          {editFailed ? (
            <span role="alert" className="review-thread-message__error">
              {copy.editErrorLabel}
            </span>
          ) : null}

          {confirmingEditDiscard ? (
            <ReviewConfirmationPanel
              heading={copy.discardHeading}
              description={copy.threadDiscardPromptLabel}
              cancelLabel={copy.keepLabel}
              confirmLabel={copy.discardButtonLabel}
              compact
              onCancel={onKeepEdit}
              onConfirm={onDiscardEdit}
            />
          ) : (
            <div className="review-thread-message__actions">
              <Button type="button" size="small" disabled={saving} onClick={onCancelEdit}>
                {copy.cancelEditLabel}
              </Button>

              <Button
                type="submit"
                size="small"
                variant="primary"
                disabled={editDraft.trim() === "" || editBodyTooLong || mutation !== null || saving}
                aria-busy={saving}
              >
                {copy.saveEditLabel}
              </Button>
              {saving ? (
                <HubVisuallyHidden role="status">{copy.savingEditLabel}</HubVisuallyHidden>
              ) : null}
            </div>
          )}
        </form>
      ) : confirmingDelete ? (
        <ReviewConfirmationPanel
          heading={copy.deleteHeading}
          description={copy.deletePromptLabel}
          errorLabel={deleteFailed ? copy.deleteErrorLabel : undefined}
          cancelLabel={copy.cancelEditLabel}
          confirmLabel={copy.confirmDeleteLabel}
          loading={deleting}
          loadingAnnouncement={copy.deletingLabel}
          compact
          onCancel={onCancelDelete}
          onConfirm={onDelete}
        />
      ) : (
        <p
          className={
            comment.body
              ? "review-thread-message__body"
              : "review-thread-message__body review-thread-message__body--deleted"
          }
        >
          {comment.body ? <MentionText comment={comment} /> : copy.deletedCommentLabel}
        </p>
      )}

      {comment.body && !(comment.kind === "root" && comment.buildNumber === null) ? (
        <ReviewCommentReactions
          comment={comment}
          mutation={mutation}
          actionsDisabled={actionsDisabled}
          controlsHidden={editing || confirmingDelete}
          copy={copy}
          onAdd={onAddReaction}
          onRemove={onRemoveReaction}
          onBurst={onBurstReaction}
        />
      ) : null}
    </article>
  )
}
