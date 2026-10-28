import { useRef } from "react"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePageData } from "@hooks/use-page-data"
import { useRepositoryInbox } from "@hooks/use-repository-inbox"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { usePrototypeViewerUrl } from "@hooks/use-prototype-viewer-url"
import { ReplicaBrowsePage } from "@pages/replica-browse-page"
import type { ReplicaBrowsePageData } from "@pages/replica-browse-page/types"
import type { AnchorReference } from "@utils/review-anchor/types"

const EMPTY_ANCHORS: AnchorReference[] = []

export default function ReplicaBrowsesShowView() {
  const data = useRepositoryInbox(usePageData<ReplicaBrowsePageData>())
  return <TemplatePreviewView key={`${data.selectedRepositoryId}:${data.templateId}`} data={data} />
}

function TemplatePreviewView({ data }: { data: ReplicaBrowsePageData }) {
  const { resolvedColorMode: previewTheme } = useHubTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridge = usePreviewBridge({
    iframeRef,
    previewUrl: data.selectedBuild?.previewUrl,
    previewTheme,
    anchors: EMPTY_ANCHORS,
    reviewEnabled: false,
  })
  const viewer = usePrototypeViewerUrl({
    selectedBuild: data.selectedBuild,
    route: bridge.route,
    initiallyMinimized: data.minimizedPreview,
    buildSelection: "ignore",
  })

  return (
    <ReplicaBrowsePage
      data={data}
      iframeRef={iframeRef}
      previewTheme={previewTheme}
      route={bridge.route}
      viewerUrl={viewer.viewerUrl}
      minimized={viewer.minimized}
      onMinimizedChange={viewer.setMinimized}
      onFrameLoad={bridge.handleFrameLoad}
    />
  )
}
