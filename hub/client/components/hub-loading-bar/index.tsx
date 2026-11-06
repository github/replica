import { HubVisuallyHidden } from "../hub-visually-hidden"

import "./styles.css"

export function HubLoadingBar() {
  return (
    <div className="hub-loading-bar" role="status" aria-label="Page loading">
      <HubVisuallyHidden>Loading page</HubVisuallyHidden>
    </div>
  )
}
