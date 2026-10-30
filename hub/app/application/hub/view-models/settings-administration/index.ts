import type { HubAdministrationPageData } from "@features/hub-administration-page/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"

import type { WorkspaceResponse } from "../../contracts"
import type { SettingsWorkspaceResponse } from "../../settings-contracts"
import { resourcePath } from "../resource-path"
import { settingsWorkspace } from "../settings-workspace"

export function settingsAdministration(
  workspace: WorkspaceResponse,
  state: SettingsWorkspaceResponse,
  search: URLSearchParams,
  selectedSection: HubAdministrationWorkspaceData["selectedSection"],
  heading: string,
  description: string,
): HubAdministrationPageData {
  const hub = settingsWorkspace(workspace, state, search, selectedSection)
  const admin = state.session.capabilities.administerHub
  return {
    administrationWorkspace: admin ? { ...hub, selectedSection } : null,
    authenticatedWorkspace: admin ? null : hub,
    heading,
    description,
    auditLabel: "Security audit",
    auditPath: resourcePath("/settings/audit", search),
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    signOutLabel: "Sign out of mock session",
    signOutPath: "/session",
    authenticityToken: "",
    notice: null,
    alert: admin
      ? null
      : "This mock profile does not include Hub administrator controls. No production permission policy is implied.",
    hubAdminsLabel: "Hub administrators",
    hubAdminsPath: resourcePath("/settings/admins", search),
    sharingSettingsLabel: "Public sharing",
    sharingSettingsPath: resourcePath("/admin/sharing", search),
    githubAppLabel: "GitHub App",
    githubAppPath: resourcePath("/settings/github", search),
    copilotConnectionLabel: "Copilot",
    copilotConnectionPath: resourcePath("/settings/copilot", search),
    sessionRevocationLabel: "Mock browser session",
    sessionRevocationPath: resourcePath("/settings/sessions", search),
  }
}
