import { useLocation } from "react-router"

import { BuildsShowPage } from "@pages/builds-show-page"

import type { BuildResponse, WorkspaceResponse } from "../../contracts"
import { buildShowData } from "../../view-models/build-show"

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
