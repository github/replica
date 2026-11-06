import { XIcon } from "@primer/octicons-react"
import { Heading } from "@primer/react-brand"
import { useEffect, useId, useRef } from "react"
import type { KeyboardEvent } from "react"

import { CopilotAppContinuation } from "@components/copilot-app-continuation"
import { HubIconButton } from "@components/hub-icon-button"
import type {
  CopilotAppContinuationCopy,
  CopilotAppSubmission,
} from "@components/copilot-app-continuation/types"

import "./styles.css"

export function CopilotAppContinuationDialog({
  submission,
  copy,
  onClose,
  onOpenApp,
}: {
  submission: CopilotAppSubmission
  copy: CopilotAppContinuationCopy
  onClose: () => void
  onOpenApp?: (url: string) => void
}) {
  const dialog = useRef<HTMLDivElement>(null)
  const headingId = useId()
  useEffect(() => {
    dialog.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab") return

    const controls = dialog.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href]",
    )
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!first || !last) return
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog.current)
    ) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="copilot-app-continuation-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        className="copilot-app-continuation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="copilot-app-continuation-dialog__header">
          <Heading as="h2" size="6" id={headingId}>
            {copy.continuationHeading}
          </Heading>

          <HubIconButton
            icon={XIcon}
            aria-label={copy.closeLabel}
            variant="invisible"
            size="small"
            onClick={onClose}
          />
        </div>

        <CopilotAppContinuation submission={submission} copy={copy} onOpenApp={onOpenApp} />
      </div>
    </div>
  )
}
