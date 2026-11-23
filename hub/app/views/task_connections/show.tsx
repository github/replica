import { usePageData } from "@hooks/use-page-data"
import { CanvasPairingsPage } from "@pages/canvas-pairings-page"
import type { CanvasPairingsPageData } from "@pages/canvas-pairings-page/types"

export default function TaskConnectionsShowView() {
  return <CanvasPairingsPage data={usePageData<CanvasPairingsPageData>()} />
}
