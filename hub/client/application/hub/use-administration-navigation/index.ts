import { useLocation, useOutletContext } from "react-router"

import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

import { ApiRequestError } from "../requests/api-request-error"
import { hubWorkspace } from "../view-models/hub-workspace"

export function useAdministrationNavigation(
  section: HubAdministrationWorkspaceData["selectedSection"],
  viewerId: string,
) {
  const workspace = useOutletContext<WorkspaceResponse>()
  const { search } = useLocation()
  if (workspace.viewer.id !== viewerId) {
    throw new ApiRequestError(401, "Your Hub session changed. Sign in again to continue.")
  }
  return hubWorkspace(workspace, new URLSearchParams(search), section)
}
