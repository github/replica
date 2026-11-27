import type { RefObject } from "react"

import type { ReviewRoute } from "@utils/review-anchor/types"

export type Props = {
  frameRef: RefObject<HTMLIFrameElement | null>
  previewUrl?: string
  onRouteChange: (route: ReviewRoute, replace?: boolean) => void
}
