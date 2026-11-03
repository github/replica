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
  if (userId !== 1 && userId !== 2) throw new Error("The requested Hub user is unavailable.")
  const login = userId === 1 ? "octocat" : "mona"
  const user = state.administrators.users.find((entry) => entry.id === userId)
  const heading =
    operation === "designate" ? "Designate Hub administrator?" : "Remove Hub administrator?"
  const blockedLabel = !state.session.capabilities.administerHub
    ? "Only a current Hub administrator can change administrator roles."
    : operation === "revoke" && state.administrators.users.length === 1 && user
      ? "The final Hub administrator cannot be removed. Designate another existing Hub user first."
      : (operation === "designate") === !!user
        ? "This user's role already changed. Review their current role and confirm again. No role changes were made."
        : null
  return {
    ...settingsAdministration(
      workspace,
      state,
      search,
      "admins",
      heading,
      operation === "designate"
        ? "This user will be able to designate and remove Hub administrators and read deployment security records. Their GitHub repository permissions will not change."
        : "This user will lose Hub administrator controls and deployment security records. Their GitHub repository permissions will not change. Removing your own role takes effect immediately.",
    ),
    pageTitle: heading,
    target: {
      login,
      name: user?.name ?? (userId === 1 ? "The Octocat" : "Mona Lisa"),
      identity: `Hub user ${userId}`,
    },
    operation,
    submitPath: resourcePath(`/settings/admins/${userId}/${operation}`, search),
    submitLabel: operation === "designate" ? "Designate administrator" : "Remove administrator",
    confirmLabel: "I confirm this Hub administrator role change.",
    cancelLabel: "Cancel",
    cancelPath: resourcePath("/settings/admins", search),
    verification:
      "A role change requires GitHub to have verified this browser's account within the last five minutes. If verification is required, Hub continues your confirmed change after it succeeds.",
    blockedLabel,
  }
}
