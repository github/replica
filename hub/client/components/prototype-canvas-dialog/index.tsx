import { XIcon } from "@primer/octicons-react"
import { Heading } from "@primer/react-brand"
import { useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react"
import { HubIconButton } from "@components/hub-icon-button"

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
      ref={dialogRef}
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
