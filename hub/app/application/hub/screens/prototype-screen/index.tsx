import { useCallback, useMemo, useRef } from "react"
import { useLocation, useRouteLoaderData, useSearchParams } from "react-router"

import { useHubTheme } from "@hooks/use-hub-theme"
import { usePrototypeReview } from "@hooks/use-prototype-review"
import { PrototypesShowPage } from "@pages/prototypes-show-page"
import type { PrototypeDetailsInput } from "@pages/prototypes-show-page/types"

import type { PrototypeResponse, WorkspaceResponse } from "../../contracts"
import { prototypeShowData } from "../../view-models/prototype-show"
import { createReviewTransport } from "../../review-transport"
import type { SessionResponse } from "../../session-contracts"
import { readReviewQuery } from "../../read-review-query"

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
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => readReviewQuery(params), [params])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedColorMode } = useHubTheme()
  const session = useRouteLoaderData<SessionResponse>("root")
  const pageData = prototypeShowData(workspace, data, new URLSearchParams(location.search))
  pageData.reviewReadOnly = session?.profile === "reader"
  if (pageData.reviewReadOnly) {
    pageData.reviewComments = {
      ...pageData.reviewComments,
      copy: {
        ...pageData.reviewComments.copy,
        selectionBlockedLabel: "This mock profile can read reviews but cannot change them.",
      },
    }
  }
  const routeUrl = `${window.location.origin}${location.pathname}`
  const transport = useMemo(
    () => createReviewTransport(routeUrl, () => window.location.href),
    [routeUrl],
  )
  const selectThread = useCallback(
    (id: number | null) => {
      setParams((current) => {
        const next = new URLSearchParams(current)
        if (id === null) next.delete("comment")
        else next.set("comment", String(id))
        return next
      })
    },
    [setParams],
  )
  const review = usePrototypeReview({
    authenticityToken: "",
    iframeRef,
    previewTheme: resolvedColorMode,
    repositoryId: data.repository.id,
    prototypeId: data.prototype.id,
    reviewCommentsPath: pageData.reviewCommentsPath,
    viewerLogin: workspace.viewer.login,
    selectedBuild: pageData.selectedBuild,
    transport,
    filters: query.filters,
    selectedThreadId: query.commentId,
    onSelectedThreadChange: selectThread,
    onFiltersChange: (filters) => {
      const next = new URLSearchParams(params)
      if (filters.search) next.set("commentSearch", filters.search)
      else next.delete("commentSearch")
      if (filters.participant) next.set("commentParticipant", filters.participant)
      else next.delete("commentParticipant")
      for (const [name, enabled] of [
        ["commentBuild", filters.currentBuildOnly],
        ["commentPage", filters.currentPageOnly],
        ["commentResolved", filters.showResolved],
        ["commentUnread", !filters.showRead],
        ["commentMine", filters.onlyMine],
      ] as const) {
        if (enabled) next.set(name, "1")
        else next.delete(name)
      }
      setParams(next)
    },
  })

  return (
    <PrototypesShowPage
      key={`${data.repository.id}:${data.prototype.id}`}
      data={pageData}
      iframeRef={iframeRef}
      previewTheme={resolvedColorMode}
      review={review}
      onSaveDetails={data.prototype.canEdit ? onSaveDetails : undefined}
      savingDetails={savingDetails}
      detailsError={detailsError}
      detailsSaved={detailsSaved}
    />
  )
}
