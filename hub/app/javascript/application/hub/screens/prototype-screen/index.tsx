import { useRef } from "react"
import { useLocation } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePreviewBridge } from "@hooks/use-preview-bridge"
import { PrototypesShowPage } from "@pages/prototypes-show-page"
import type { PrototypeDetailsInput } from "@pages/prototypes-show-page/types"
import type { AnchorReference } from "@utils/review-anchor/types"

import type { PrototypeResponse, WorkspaceResponse } from "../../contracts"
import { prototypeShowData } from "../../view-models/prototype-show"

const noReviewAnchors: AnchorReference[] = []

export function PrototypeScreen({
  workspace,
  data,
  onSaveDetails,
  savingDetails,
  detailsError,
  detailsSaved,
}: {
  workspace: WorkspaceResponse
  data: PrototypeResponse
  onSaveDetails: (details: PrototypeDetailsInput) => void
  savingDetails: boolean
  detailsError: string | null
  detailsSaved: boolean
}) {
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const pageData = prototypeShowData(workspace, data, new URLSearchParams(location.search))
  const bridge = usePreviewBridge({
    iframeRef,
    previewUrl: pageData.selectedBuild?.previewUrl,
    previewTheme: resolvedColorMode,
    anchors: noReviewAnchors,
    reviewEnabled: false,
  })

  return (
    <PrototypesShowPage
      key={`${data.repository.id}:${data.prototype.id}`}
      data={pageData}
      iframeRef={iframeRef}
      previewTheme={resolvedColorMode}
      previewBridge={bridge}
      reviewUnavailableLabel="Preview only. Reviews are not connected in this local frontend."
      onSaveDetails={data.prototype.canEdit ? onSaveDetails : undefined}
      savingDetails={savingDetails}
      detailsError={detailsError}
      detailsSaved={detailsSaved}
    />
  )
}
