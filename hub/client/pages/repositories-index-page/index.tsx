import { HubEmptyState } from "@components/hub-empty-state"
import { HubWorkspace } from "@features/hub-workspace"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

export function RepositoriesIndexPage({ data }: { data: HubWorkspaceData }) {
  return (
    <HubWorkspace data={data}>
      <HubEmptyState
        heading="No repositories available"
        description={
          data.currentUser.provider === "local"
            ? "Run local Builds to discover your prototype repositories, then refresh this page."
            : "No repositories are available to this viewer."
        }
      />
    </HubWorkspace>
  )
}
