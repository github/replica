import { XIcon } from "@primer/octicons-react"
import { Button, Heading, Tooltip } from "@primer/react-brand"
import { useEffect, useId, useRef, useState } from "react"
import type { SubmitEvent } from "react"

import { ReviewConfirmationPanel } from "@features/review-confirmation-panel"
import { HubAlert } from "@components/hub-alert"
import { MentionInput } from "@components/mention-input"
import { HubIconButton } from "@components/hub-icon-button"
import { HubVisuallyHidden } from "@components/hub-visually-hidden"
import { useReviewCardPosition } from "@hooks/use-review-card-position"
import { isMacPlatform } from "@utils/is-mac-platform"
import { isSubmitShortcut } from "@utils/is-submit-shortcut"

import type { ReviewCommentComposerProps } from "./types"

import "./styles.css"

const TEXT_ENCODER = new TextEncoder()

export function ReviewCommentComposer({
  anchorPoint,
  bodyMaximumBytes,
  copy,
  creating,
  submitError,
  onSubmit,
  onDiscard,
}: ReviewCommentComposerProps) {
  const headingId = useId()
  const [draft, setDraft] = useState("")
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [createFailed, setCreateFailed] = useState(false)
  const wasConfirmingDiscard = useRef(false)
  const { cardRef, position } = useReviewCardPosition({
    anchorPoint,
    layoutKey: `${confirmingDiscard}:${createFailed}:${submitError ?? ""}`,
    preserveVerticalSide: true,
  })
  const bodyBytes = TEXT_ENCODER.encode(draft).length
  const bodyTooLong = bodyBytes > bodyMaximumBytes
  const canSubmit = draft.trim() !== "" && !bodyTooLong && !creating && !confirmingDiscard
  const submitTooltip = isMacPlatform() ? copy.submitTooltipMacLabel : copy.submitTooltipOtherLabel

  useEffect(() => {
    if (confirmingDiscard) {
      cardRef.current
        ?.querySelector<HTMLButtonElement>(".review-confirmation-panel__cancel")
        ?.focus({ preventScroll: true })
    } else if (wasConfirmingDiscard.current) {
      cardRef.current
        ?.querySelector<HTMLTextAreaElement>("textarea")
        ?.focus({ preventScroll: true })
    }
    wasConfirmingDiscard.current = confirmingDiscard
  }, [cardRef, confirmingDiscard])

  function requestDismissal() {
    if (creating) return

    if (draft.trim() === "") {
      onDiscard()
      return
    }

    setConfirmingDiscard(true)
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    const saved = await onSubmit(draft)
    if (!saved) setCreateFailed(true)
  }

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="review-comment-composer-backdrop"
        onClick={requestDismissal}
      />

      <section
        ref={cardRef}
        role="dialog"
        aria-labelledby={headingId}
        className="review-comment-composer"
        style={{ left: position.left, top: position.top }}
      >
        <form
          className="review-comment-composer__form"
          onSubmit={(event) => {
            void handleSubmit(event)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return

            event.preventDefault()
            if (confirmingDiscard) setConfirmingDiscard(false)
            else requestDismissal()
          }}
        >
          <header className="review-comment-composer__header">
            <Heading as="h2" size="6" id={headingId}>
              {copy.composerHeading}
            </Heading>

            <HubIconButton
              icon={XIcon}
              aria-label={copy.closeComposerLabel}
              description={copy.closeComposerLabel}
              variant="invisible"
              type="button"
              disabled={creating}
              onClick={requestDismissal}
            />
          </header>

          <MentionInput
            autoFocus
            aria-label={copy.composerLabel}
            placeholder={copy.composerPlaceholder}
            value={draft}
            rows={4}
            onValueChange={(value) => {
              setDraft(value)
              setConfirmingDiscard(false)
              setCreateFailed(false)
            }}
            onKeyDown={(event) => {
              if (!canSubmit || !isSubmitShortcut(event.nativeEvent)) return

              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }}
          />

          {bodyTooLong ? (
            <span role="alert" className="review-comment-composer__error">
              {copy.bodyTooLongLabel}
            </span>
          ) : null}

          {createFailed ? (
            <HubAlert
              variant="critical"
              title={copy.createErrorLabel}
              description={submitError}
              className="review-comment-composer__banner"
            />
          ) : null}

          {confirmingDiscard ? (
            <ReviewConfirmationPanel
              heading={copy.discardHeading}
              description={copy.discardPromptLabel}
              cancelLabel={copy.keepLabel}
              confirmLabel={copy.discardButtonLabel}
              condensed
              onCancel={() => setConfirmingDiscard(false)}
              onConfirm={onDiscard}
            />
          ) : (
            <footer className="review-comment-composer__actions">
              <Button type="button" size="small" disabled={creating} onClick={requestDismissal}>
                {copy.closeComposerLabel}
              </Button>

              <Tooltip text={submitTooltip} type="description">
                <Button
                  type="submit"
                  size="small"
                  variant="primary"
                  disabled={!canSubmit}
                  aria-busy={creating}
                >
                  {copy.submitLabel}
                </Button>
              </Tooltip>
              {creating ? (
                <HubVisuallyHidden role="status">{copy.submittingLabel}</HubVisuallyHidden>
              ) : null}
            </footer>
          )}
        </form>
      </section>
    </>
  )
}
