import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

import { ApiContractError } from "../requests/api-contract-error"
import { ApiRequestError } from "../requests/api-request-error"
import { getWorkspace } from "../requests/get-workspace"
import { hubWorkspace } from "../view-models/hub-workspace"

export async function loadAdministratorWorkspace(
  request: Request,
  session: CurrentHubSession,
  selectedSection: HubAdministrationWorkspaceData["selectedSection"],
): Promise<HubAdministrationWorkspaceData> {
  const search = new URL(request.url).searchParams
  let workspace
  try {
    workspace = await getWorkspace(request)
  } catch (error) {
    if (
      !(error instanceof ApiContractError || error instanceof ApiRequestError) ||
      error.status === 401 ||
      error.status === 403
    ) {
      throw error
    }
    // Repository navigation can fail without blocking the independently authorized Hub page.
    return {
      ...hubWorkspace(
        {
          viewer: {
            id: session.userId,
            login: session.login,
            name: session.name,
            provider: session.provider,
            avatarUrl: null,
          },
          repositories: [],
          reviewInboxAvailable: session.reviewInboxAvailable,
          capabilities: {
            createPrototypes: false,
            reviewPrototypes: false,
            manageSharing: false,
            administerHub: session.role === "ADMINISTRATOR",
          },
        },
        search,
        selectedSection,
      ),
      emptyRepositoryLabel: "Repository navigation unavailable",
    }
  }
  if (workspace.viewer.id !== session.userId) {
    throw new ApiRequestError(401, "Your Hub session changed. Sign in again to continue.")
  }
  return hubWorkspace(workspace, search, selectedSection)
}
