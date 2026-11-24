import { Navigate, useLocation, useOutletContext } from "react-router"

import { RepositoriesIndexPage } from "@pages/repositories-index-page"
import { HubApplication } from "@application/hub-application"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import { selectWorkspaceRepository } from "@application/hub/view-models/select-workspace-repository"
import { workspaceNavigation } from "@application/hub/view-models/workspace-navigation"

import type { WorkspaceRouteHandle } from "../workspace/types"

export const handle = {
  workspaceSection: "prototypes",
  signedOutEntry: "home",
} satisfies WorkspaceRouteHandle

export default function Home() {
  const workspace = useOutletContext<WorkspaceResponse | null>()
  const search = new URLSearchParams(useLocation().search)
  if (!workspace) return <HubApplication />
  const repository = selectWorkspaceRepository(workspace, search)
  if (repository) return <Navigate replace to={`/repositories/${repository.id}`} />
  return (
    <RepositoriesIndexPage
      data={{
        ...workspaceNavigation(workspace, null),
        repository: null,
        selectedSection: "prototypes",
      }}
    />
  )
}
