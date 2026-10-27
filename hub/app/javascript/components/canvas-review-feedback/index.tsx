import { useCallback, useMemo, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { ReviewErrorContext } from "@hooks/use-review-error/context"
import { canvasReviewError } from "@utils/canvas-review-error"
import { copy } from "@utils/prototype-canvas/en"
import { HubAlert } from "../hub-alert"

import "./styles.css"

export function CanvasReviewFeedback({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState(new Map<string, string>())
  const [dialogs, setDialogs] = useState<HTMLDialogElement[]>([])
  const report = useCallback((id: string, message: string) => {
    const visible = canvasReviewError(message)
    setErrors((current) => {
      if ((current.get(id) ?? "") === visible) return current
      const next = new Map(current)
      if (visible) next.set(id, visible)
      else next.delete(id)
      return next
    })
  }, [])
  const registerDialog = useCallback((dialog: HTMLDialogElement) => {
    setDialogs((current) => [...current, dialog])
    return () => setDialogs((current) => current.filter((item) => item !== dialog))
  }, [])
  const feedback = useMemo(() => ({ report, registerDialog }), [report, registerDialog])
  const message = [...errors.values()].at(-1)
  const notification = message ? (
    <div role="region" aria-label={copy.commentNotifications} className="canvas-review-feedback">
      <HubAlert
        variant="critical"
        title={message}
        dismissLabel={copy.dismissCommentNotification}
        onDismiss={() =>
          setErrors((current) => new Map([...current].filter(([, value]) => value !== message)))
        }
      />
    </div>
  ) : null
  const dialog = dialogs.at(-1)

  return (
    <ReviewErrorContext value={feedback}>
      {children}
      {dialog ? createPortal(notification, dialog) : notification}
    </ReviewErrorContext>
  )
}
