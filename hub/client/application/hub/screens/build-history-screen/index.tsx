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
  const mock = import.meta.env.DEV && import.meta.env.MODE === "mock"

  return (
    <BuildsIndexPage
      data={buildHistoryData(workspace, data, new URLSearchParams(location.search), {
        real: !mock,
      })}
    />
  )
}
