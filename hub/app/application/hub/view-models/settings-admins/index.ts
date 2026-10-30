import type { HubAdminsPageData } from "@pages/hub-admins-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
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
      "Edit the synthetic administrator roster. Mock profile capabilities are provisional and are not production permissions.",
    ),
    pageTitle: "Mock Hub administrators",
    emptyLabel: denied
      ? "Administrator fixture data is unavailable to this mock profile."
      : "No mock administrators.",
    nextLabel: "Next",
    nextPath: null,
    addLabel: "Add mock administrator",
    administratorsLabel: denied ? null : `${state.administrators.users.length} mock administrators`,
    addAdministrator: denied
      ? null
      : {
          submitPath: resourcePath("/settings/admins", search),
          searchPath: "/api/settings/admin-candidates",
          heading: "Add mock administrators",
          description:
            "Choose an existing synthetic user. No GitHub permissions or real roles change.",
          searchLabel: "Find a synthetic user",
          searchPlaceholder: "Search octocat or mona",
          loadingLabel: "Finding mock users…",
          emptyLabel: "No matching synthetic users outside the mock roster.",
          moreLabel: "More mock users",
          selectedLabel: "Selected users",
          confirmLabel: "Add these synthetic users to the local mock roster.",
          submitLabel: "Add selected mock users",
          searchFailedLabel: "Mock user search failed. Your selection is kept.",
          retryLabel: "Retry",
          cancelLabel: "Cancel",
        },
    users: state.administrators.users.map((user) => ({
      ...user,
      identity: `Synthetic Hub user ${user.id}; no provider identity`,
      role: "Mock administrator",
      actionLabel: "Review removal",
      confirmationPath: resourcePath(`/settings/admins/${user.id}/revoke`, search),
    })),
  }
}
