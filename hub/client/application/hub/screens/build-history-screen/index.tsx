import { useLocation } from "react-router"

import { BuildsIndexPage } from "@pages/builds-index-page"
import type { BuildHistoryResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import { buildHistoryData } from "@application/hub/view-models/build-history-data"

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
