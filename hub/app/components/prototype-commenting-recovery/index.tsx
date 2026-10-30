import { Button } from "@primer/react-brand"
import { useId } from "react"

import { CanvasDialog } from "../prototype-canvas-dialog"
import { copy } from "@utils/prototype-canvas/en"
import "./styles.css"

export function CommentingRecovery({
  error,
  busy,
  requested,
  onFix,
  onDismiss,
}: {
  error?: string
  busy: boolean
  requested: boolean
  onFix: () => void
  onDismiss: () => void
}) {
  const descriptionId = useId()
  return (
    <CanvasDialog
      title={copy.commentingUnavailable}
      descriptionId={descriptionId}
      closeLabel={copy.closeCommentingDialog}
      onClose={onDismiss}
    >
      <p id={descriptionId}>{copy.commentingDescription}</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="canvas-commenting-recovery__actions">
        <Button variant="primary" disabled={busy || requested} onClick={onFix}>
          {requested ? copy.commentingFixRequested : copy.commentingFix}
        </Button>
        <Button variant="subtle" onClick={onDismiss}>
          {copy.commentingDismiss}
        </Button>
      </div>
    </CanvasDialog>
  )
}
