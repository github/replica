import { Button } from "@primer/react-brand"

import { HubVisuallyHidden } from "@components/hub-visually-hidden"

import type { ReviewConfirmationPanelProps } from "./types"

import "./styles.css"

/** Presents a consistent confirmation before discarding review content. */
export function ReviewConfirmationPanel({
  cancelLabel,
  confirmLabel,
  description,
  errorLabel,
  heading,
  loading = false,
  loadingAnnouncement,
  compact = false,
  condensed = false,
  onCancel,
  onConfirm,
}: ReviewConfirmationPanelProps) {
  const cancelButton = (
    <Button
      type="button"
      size="small"
      variant={condensed ? "primary" : undefined}
      className="review-confirmation-panel__cancel"
      onClick={onCancel}
    >
      {cancelLabel}
    </Button>
  )
  const confirmButton = (
    <Button
      type="button"
      size="small"
      variant={condensed ? "secondary" : "primary"}
      className={condensed ? undefined : "review-confirmation-panel__danger"}
      disabled={loading}
      aria-busy={loading}
      onClick={onConfirm}
    >
      {confirmLabel}
    </Button>
  )

  return (
    <div
      className={`review-confirmation-panel${
        compact || condensed ? " review-confirmation-panel--compact" : ""
      }${condensed ? " review-confirmation-panel--condensed" : ""}`}
      role="alert"
    >
      <div className="review-confirmation-panel__copy">
        <strong>{heading}</strong>
        {condensed ? (
          <HubVisuallyHidden>{description}</HubVisuallyHidden>
        ) : (
          <span>{description}</span>
        )}
      </div>

      {errorLabel ? <span className="review-confirmation-panel__error">{errorLabel}</span> : null}

      <div className="review-confirmation-panel__actions">
        {condensed ? confirmButton : cancelButton}
        {condensed ? cancelButton : confirmButton}
        {loading && loadingAnnouncement ? (
          <HubVisuallyHidden role="status">{loadingAnnouncement}</HubVisuallyHidden>
        ) : null}
      </div>
    </div>
  )
}
