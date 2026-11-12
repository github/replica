import { Button } from "@primer/react-brand"
import { useId, type RefObject } from "react"

import { BranchPublication } from "../prototype-branch-publication"
import { CanvasDialog } from "../prototype-canvas-dialog"
import type { ShareReadiness } from "@utils/resolve-prototype-share-readiness"
import { readinessCopy as copy } from "@utils/resolve-prototype-share-readiness/en"
import { publicationCopy } from "@utils/resolve-prototype-publication/en"

export function ShareReadinessDialog({
  readiness,
  busy,
  shareButtonRef,
  onClose,
  onConnect,
  onPublish,
  onRetry,
  onManage,
}: {
  readiness: ShareReadiness
  busy: boolean
  shareButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onConnect: () => void
  onPublish: () => void
  onRetry: () => void
  onManage: () => void
}) {
  const descriptionId = useId()
  return (
    <CanvasDialog
      title={readiness.title}
      closeLabel={copy.close}
      onClose={onClose}
      returnFocusRef={shareButtonRef}
      descriptionId={descriptionId}
    >
      <p id={descriptionId} role="status">
        {readiness.detail}
      </p>
      {["connect", "publish", "ready"].includes(readiness.kind) ? <p>{copy.boundary}</p> : null}
      {readiness.publication ? (
        <BranchPublication
          publication={readiness.publication}
          dirty={false}
          busy={busy}
          onPublish={onPublish}
          onRetry={onRetry}
        />
      ) : null}
      {["connect", "ready", "retry"].includes(readiness.kind) ? (
        <Button
          variant="primary"
          size="small"
          disabled={busy}
          aria-busy={busy}
          onClick={
            readiness.kind === "connect"
              ? onConnect
              : readiness.kind === "ready"
                ? onManage
                : onRetry
          }
        >
          {readiness.kind === "connect"
            ? copy.connectAction
            : readiness.kind === "ready"
              ? copy.manage
              : publicationCopy.retry}
        </Button>
      ) : null}
    </CanvasDialog>
  )
}
