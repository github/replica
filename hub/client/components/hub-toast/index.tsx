import { useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { HubAlert } from "../hub-alert"
import { toastRegion } from "./toast-region"

import "./styles.css"

export function HubToast({
  title,
  variant = "success",
}: {
  title: string
  variant?: "success" | "info"
}) {
  const region = useSyncExternalStore(
    toastRegion.subscribe,
    toastRegion.getSnapshot,
    toastRegion.getServerSnapshot,
  )
  const [dismissed, setDismissed] = useState(false)
  const [previousTitle, setPreviousTitle] = useState(title)

  // React retries this render before committing, so a new title is never briefly dismissed.
  if (title !== previousTitle) {
    setPreviousTitle(title)
    setDismissed(false)
  }

  return region && !dismissed
    ? createPortal(
        <HubAlert
          className="hub-toast"
          title={title}
          variant={variant}
          aria-atomic="true"
          dismissLabel="Dismiss notification"
          onDismiss={() => setDismissed(true)}
        />,
        region,
      )
    : null
}
