import { ArrowUpRightIcon } from "@primer/octicons-react"
import { Tooltip } from "@primer/react-brand/esm"
import { useLayoutEffect, useRef } from "react"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { MentionInput } from "@components/mention-input"
import { ReviewConfirmationPanel } from "@features/review-confirmation-panel"
import { isMacPlatform } from "@utils/is-mac-platform"
import { isSubmitShortcut } from "@utils/is-submit-shortcut"
import { useReviewError } from "@hooks/use-review-error"

import type { ReviewThreadReplyFormProps } from "./types"

import "./styles.css"

/** Shows one reply composer or the thread state that prevents new replies. */
export function ReviewThreadReplyForm({
  blockedLabel,
  confirmingDiscard,
  replyDraft,
  replyBodyTooLong,
  replyFailed,
  replyDisabled,
  replying,
  submitDisabled = false,
  copy,
  onKeepDraft,
  onDiscardDraft,
  onSubmit,
  onDraftChange,
}: ReviewThreadReplyFormProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const showLengthError = useReviewError(replyBodyTooLong && copy.bodyTooLongLabel)
  const showReplyError = useReviewError(replyFailed && copy.replyErrorLabel)
  const canSubmit =
    replyDraft.trim() !== "" &&
    !replyBodyTooLong &&
    !replyDisabled &&
    !replying &&
    !submitDisabled &&
    !confirmingDiscard &&
    !blockedLabel
  const submitTooltip = isMacPlatform()
    ? copy.replySubmitTooltipMacLabel
    : copy.replySubmitTooltipOtherLabel

  useLayoutEffect(() => {
    if (!inputRef.current) return
    inputRef.current.style.height = "auto"
    inputRef.current.style.height = replyDraft
      ? `${Math.min(inputRef.current.scrollHeight, 120)}px`
      : "2.5rem"
  }, [replyDraft])

  if (confirmingDiscard) {
    return (
      <ReviewConfirmationPanel
        heading={copy.discardHeading}
        description={copy.threadDiscardPromptLabel}
        cancelLabel={copy.keepLabel}
        confirmLabel={copy.discardButtonLabel}
        compact
        onCancel={onKeepDraft}
        onConfirm={onDiscardDraft}
      />
    )
  }

  if (blockedLabel) {
    return <span className="review-thread-reply-form__blocked">{blockedLabel}</span>
  }

  return (
    <form
      className="review-thread-reply-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit()
      }}
    >
      <div className="review-thread-reply-form__composer">
        <MentionInput
          ref={inputRef}
          aria-label={copy.replyLabel}
          placeholder={copy.replyPlaceholder}
          value={replyDraft}
          rows={1}
          disabled={replyDisabled}
          onValueChange={onDraftChange}
          onKeyDown={(event) => {
            if (!canSubmit || !isSubmitShortcut(event.nativeEvent, { allowPlainEnter: true })) {
              return
            }

            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }}
        />

        <Tooltip text={submitTooltip} type="description">
          <button
            type="submit"
            className="review-thread-reply-form__submit"
            disabled={!canSubmit}
            aria-label={copy.replySubmitLabel}
            aria-busy={replying}
          >
            <ArrowUpRightIcon size={16} />
          </button>
        </Tooltip>
      </div>

      {showLengthError ? (
        <span role="alert" className="review-thread-reply-form__error">
          {copy.bodyTooLongLabel}
        </span>
      ) : null}

      {showReplyError ? (
        <span role="alert" className="review-thread-reply-form__error">
          {copy.replyErrorLabel}
        </span>
      ) : null}

      {replying ? <HubVisuallyHidden role="status">{copy.replyingLabel}</HubVisuallyHidden> : null}
    </form>
  )
}
