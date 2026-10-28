import { XIcon } from "@primer/octicons-react"
import { Heading } from "@primer/react-brand"
import {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react"
import { HubIconButton } from "@components/hub-icon-button"
import { ReviewErrorContext } from "@hooks/use-review-error/context"

import "./styles.css"

export function CanvasDialog({
  title,
  closeLabel,
  onClose,
  returnFocusRef,
  descriptionId,
  className,
  children,
}: {
  title: string
  closeLabel: string
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  descriptionId?: string
  className?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const feedback = useContext(ReviewErrorContext)
  const registerDialog = feedback?.registerDialog
  const attachDialog = useCallback(
    (dialog: HTMLDialogElement | null) => {
      dialogRef.current = dialog
      // Keep canvas notifications in the modal's top layer, outside its content.
      if (dialog) return registerDialog?.(dialog)
    },
    [registerDialog],
  )

  // Open the dialog before child effects try to focus its controls.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const returnFocus =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    dialog?.showModal()
    return () => {
      dialog?.close()
      // eslint-disable-next-line react-hooks/exhaustive-deps -- The caller can replace a deleted opener with a live fallback.
      const target = returnFocusRef?.current ?? returnFocus
      target?.focus()
    }
  }, [returnFocusRef])

  return (
    <dialog
      ref={attachDialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={className ? `canvas-dialog ${className}` : "canvas-dialog"}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX < left ||
          event.clientX > right ||
          event.clientY < top ||
          event.clientY > bottom
        )
          onClose()
      }}
    >
      <header className="canvas-dialog-header">
        <Heading as="h2" size="5" id={titleId}>
          {title}
        </Heading>
        <HubIconButton
          variant="default"
          size="small"
          icon={XIcon}
          aria-label={closeLabel}
          onClick={onClose}
        />
      </header>
      {children}
    </dialog>
  )
}
