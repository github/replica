import { Navigate, useOutletContext } from "react-router"

import { HubEmptyState } from "@components/hub-empty-state"

import type { WorkspaceResponse } from "../../contracts"

export default function HomeRoute() {
  const workspace = useOutletContext<WorkspaceResponse>()
  const firstRepository = workspace.repositories[0]
  return firstRepository ? (
    <Navigate to={`/repositories/${firstRepository.id}`} replace />
  ) : (
    <main>
      <HubEmptyState
        heading="No repositories available"
        description="No repositories are available to this viewer."
      />
    </main>
  )
}
