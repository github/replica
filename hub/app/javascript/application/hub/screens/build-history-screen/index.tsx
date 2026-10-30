import { useLocation } from "react-router"

import { BuildsIndexPage } from "@pages/builds-index-page"

import type { BuildHistoryResponse, WorkspaceResponse } from "../../contracts"
import { buildHistoryData } from "../../view-models/build-history"

export function BuildHistoryScreen({
  workspace,
  data,
}: {
  workspace: WorkspaceResponse
  data: BuildHistoryResponse
}) {
  const location = useLocation()

  return (
    <BuildsIndexPage
      data={buildHistoryData(workspace, data, new URLSearchParams(location.search))}
    />
  )
}
