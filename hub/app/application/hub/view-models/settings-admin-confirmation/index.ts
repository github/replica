import type { HubAdminConfirmationPageData } from "@pages/hub-admin-confirmation-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsAdministration } from "../settings-administration"

export function settingsAdminConfirmation(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  userId: number,
  operation: "designate" | "revoke",
): HubAdminConfirmationPageData {
  if (userId !== 1 && userId !== 2)
    throw new Error("An unknown synthetic administrator reached this presentation.")
  const login = userId === 1 ? "octocat" : "mona"
  const user = state.administrators.users.find((entry) => entry.id === userId)
  const heading =
    operation === "designate" ? "Add mock administrator?" : "Remove mock administrator?"
  const blockedLabel = !state.session.capabilities.administerHub
    ? "This mock profile cannot change the roster."
    : operation === "revoke" && state.administrators.users.length === 1 && user
      ? "Keep one administrator in this demonstration fixture. This is not a production permission policy."
      : (operation === "designate") === !!user
        ? "The mock roster already changed. Return to the roster and review the current state."
        : null
  return {
    ...settingsAdministration(
      workspace,
      state,
      search,
      "admins",
      heading,
      "Confirm this synthetic user's local roster change. Real roles and repository access stay unchanged.",
    ),
    pageTitle: heading,
    target: {
      login,
      name: user?.name ?? (userId === 1 ? "The Octocat" : "Mona Lisa"),
      identity: `Synthetic Hub user ${userId}; no GitHub identity check`,
    },
    operation,
    submitPath: resourcePath(`/settings/admins/${userId}/${operation}`, search),
    submitLabel: operation === "designate" ? "Add mock administrator" : "Remove mock administrator",
    confirmLabel: "I confirm this local mock roster change.",
    cancelLabel: "Cancel",
    cancelPath: resourcePath("/settings/admins", search),
    verification:
      login === workspace.viewer.login && operation === "revoke"
        ? "Removing Octocat returns this browser to the Owner mock profile."
        : "This confirmation does not contact an identity provider.",
    blockedLabel,
  }
}
