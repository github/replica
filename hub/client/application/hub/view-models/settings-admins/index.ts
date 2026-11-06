import type { HubAdminsPageData } from "@pages/hub-admins-page/types"

import type { WorkspaceResponse } from "../../contracts/types"
import type { SettingsWorkspaceResponse } from "../../settings-contracts/types"
import { resourcePath } from "../resource-path"
import { settingsAdministration } from "../settings-administration"

export function settingsAdmins(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
): HubAdminsPageData {
  const denied = state.administrators.accessDenied
  return {
    ...settingsAdministration(
      workspace,
      state,
      search,
      "admins",
      "Hub administrators",
      "Hub administrators can manage this deployment and read its security records. This role never grants access to GitHub repositories.",
    ),
    pageTitle: "Hub administrators",
    emptyLabel: denied
      ? "Your GitHub repository permissions are unchanged. Hub administrator controls and deployment security records are not available to this account."
      : "No Hub administrators are available.",
    nextLabel: "Next page",
    nextPath: null,
    addLabel: "Add administrator",
    administratorsLabel: denied
      ? null
      : `${state.administrators.users.length} ${state.administrators.users.length === 1 ? "administrator" : "administrators"}`,
    addAdministrator: denied
      ? null
      : {
          submitPath: resourcePath("/settings/admins", search),
          searchPath: "/api/settings/admin-candidates",
          heading: "Add administrator",
          description:
            "Select existing Hub users to give them administrator controls and access to deployment security records. Their GitHub repository permissions will not change.",
          searchLabel: "Search Hub users",
          searchPlaceholder: "Search by name or login",
          loadingLabel: "Searching Hub users…",
          emptyLabel: "No matching Hub users are available.",
          moreLabel: "Showing the first 50 matches. Refine your search to find other users.",
          selectedLabel: "Selected users",
          confirmLabel: "I confirm adding the selected users as Hub administrators.",
          submitLabel: "Add selected administrators",
          searchFailedLabel: "Hub could not search users. Try again. No role changes were made.",
          retryLabel: "Try again",
          cancelLabel: "Cancel",
        },
    users: state.administrators.users.map((user) => ({
      ...user,
      identity: `Hub user ${user.id}`,
      role: "Hub administrator",
      actionLabel: "Remove administrator",
      confirmationPath: resourcePath(`/settings/admins/${user.id}/revoke`, search),
    })),
  }
}
