import type { RefObject } from "react"

export type Props = {
  frameRef: RefObject<HTMLIFrameElement | null>
  prototypeUrl: string | null
  previewUrl?: string
  enabled: boolean
  onToggle: () => void
}
