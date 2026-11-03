import type { RefObject } from "react"

import type { ShareReadiness } from "@utils/resolve-prototype-share-readiness"
import type { PrototypeState } from "@utils/prototype-canvas/types"
import type { useCanvasPublication } from "@hooks/use-canvas-publication"
import type { useHubConnection } from "@hooks/use-canvas-hub-connection"
import type { useHubStatus } from "@hooks/use-canvas-hub-status"
import type { useShareControlSettings } from "@hooks/use-prototype-share-control-settings"
import type { useShareIntent } from "@hooks/use-canvas-share-intent"
import type { useShareLinks } from "@hooks/use-canvas-share-links"

export type Props = {
  hub: ReturnType<typeof useHubStatus>
  connection: ReturnType<typeof useHubConnection>
  publication: ReturnType<typeof useCanvasPublication>
  sharing: ReturnType<typeof useShareLinks>
  shareIntent: ReturnType<typeof useShareIntent>
  controlSettings: ReturnType<typeof useShareControlSettings>
  readiness: ShareReadiness
  state: PrototypeState | null
  hubOpen: boolean
  buildDetailsOpen: boolean
  onCloseBuildDetails: () => void
  shareButtonRef: RefObject<HTMLButtonElement | null>
  hubButtonRef: RefObject<HTMLButtonElement | null>
  connectionButtonRef: RefObject<HTMLButtonElement | null>
  publishButtonRef: RefObject<HTMLButtonElement | null>
  titleButtonRef: RefObject<HTMLButtonElement | null>
}
