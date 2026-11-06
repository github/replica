import type { HubAdministrationPageData } from "@features/hub-administration-page/types"
import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { WorkspaceResponse } from "@application/hub/contracts/types"
import type { SettingsWorkspaceResponse } from "@application/hub/settings-contracts/types"

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
    repositoriesPath: "/repositories",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    authenticityToken: "",
    notice: null,
    alert: admin ? null : "Your account is not a current Hub administrator.",
    hubAdminsLabel: "Hub administrators",
    hubAdminsPath: resourcePath("/settings/admins", search),
    sharingSettingsLabel: "Public sharing",
    sharingSettingsPath: resourcePath("/settings/sharing", search),
    githubAppLabel: "GitHub App",
    githubAppPath: resourcePath("/settings/github", search),
    copilotConnectionLabel: "Copilot",
    copilotConnectionPath: resourcePath("/settings/copilot", search),
    sessionRevocationLabel: "End all Hub sessions",
    sessionRevocationPath: resourcePath("/settings/sessions", search),
  }
}
