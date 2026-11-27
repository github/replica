import type { Dispatch, RefObject, SetStateAction } from "react"

import type { ControlsConnection, PanelState } from "@utils/prototype-controls-connection"
import type { ControlsPanelLayout } from "@components/prototype-controls-panel/types"

export type BrowserPreviewSurfaceProps = {
  name: string
  source?: string
  frameKey: number
  frameRef: RefObject<HTMLIFrameElement | null>
  shellRef: RefObject<HTMLElement | null>
  onFrameLoad?: () => void
  appearance: "light" | "dark"
  state: PanelState | null
  connection: Pick<ControlsConnection, "command" | "retry" | "resetAll"> | null
  layout: ControlsPanelLayout
  onLayoutChange: Dispatch<SetStateAction<ControlsPanelLayout>>
}
