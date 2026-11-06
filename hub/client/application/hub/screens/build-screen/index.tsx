import { useLocation } from "react-router"

import { BuildsShowPage } from "@pages/builds-show-page"
import type { BuildResponse, WorkspaceResponse } from "@application/hub/contracts/types"
import { buildShowData } from "@application/hub/view-models/build-show-data"

export function BuildScreen({
  workspace,
  data,
}: {
  workspace: WorkspaceResponse
  data: BuildResponse
}) {
  const location = useLocation()

  return (
    <BuildsShowPage data={buildShowData(workspace, data, new URLSearchParams(location.search))} />
  )
}
