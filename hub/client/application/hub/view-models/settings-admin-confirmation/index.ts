import type { HubAdminConfirmationPageData } from "@pages/hub-admin-confirmation-page/types"

import type { WorkspaceResponse } from "../../contracts/types"
import type {
  SettingsCandidateResponse,
  SettingsWorkspaceResponse,
} from "../../settings-contracts/types"
import { resourcePath } from "../resource-path"
import { settingsAdministration } from "../settings-administration"

export function settingsAdminConfirmation(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  target: SettingsCandidateResponse["users"][number],
  operation: "designate" | "revoke",
): HubAdminConfirmationPageData {
  const user = state.administrators.users.find((entry) => entry.id === target.id)
  const heading =
    operation === "designate" ? "Designate Hub administrator?" : "Remove Hub administrator?"
  const blockedLabel = !state.session.capabilities.administerHub
    ? "Only a current Hub administrator can change administrator roles."
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
      login: target.login,
      name: target.name,
      identity: `Hub user ${target.id}`,
    },
    operation,
    submitPath: resourcePath(`/settings/admins/${target.id}/${operation}`, search),
    submitLabel: operation === "designate" ? "Designate administrator" : "Remove administrator",
    confirmLabel: "I confirm this Hub administrator role change.",
    cancelLabel: "Cancel",
    cancelPath: resourcePath("/settings/admins", search),
    verification:
      "A role change requires GitHub to have verified this browser's account within the last five minutes. If verification is required, Hub continues your confirmed change after it succeeds.",
    blockedLabel,
  }
}
