import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

import { authenticatedHeaderData } from "./authenticated-header"
import { prototypeWorkspaceData } from "./prototype-workspace"

export const authenticatedHubWorkspaceData: HubWorkspaceData = {
  ...authenticatedHeaderData,
  navigationLabel: "Hub navigation",
  collapseNavigationLabel: "Collapse sidebar",
  expandNavigationLabel: "Expand sidebar",
  repositoriesLabel: "Repositories",
  repositoriesPath: "/repositories",
  settingsNavigationLabel: "Security and settings",
  repository: {
    ...prototypeWorkspaceData,
    analyticsLabel: "Analytics",
    analyticsPath: "/repositories/2001/analytics",
  },
  securityAuditLabel: "Security audit",
  securityAuditPath: "/repositories/2001/security_audit",
}

export const hubAdministrationWorkspaceData: HubAdministrationWorkspaceData = {
  ...authenticatedHubWorkspaceData,
  navigationLabel: "Repository navigation",
  selectedSection: "admins",
  administrationLinks: [
    { section: "github", label: "GitHub App", path: "/github_app" },
    { section: "copilot", label: "Copilot", path: "/copilot" },
    { section: "admins", label: "Hub administrators", path: "/hub_admins" },
    { section: "sharing", label: "Public sharing", path: "/sharing_settings" },
    { section: "sessions", label: "End all Hub sessions", path: "/session_revocation" },
  ],
}

export const hubAdministrationData = {
  administrationWorkspace: hubAdministrationWorkspaceData,
  heading: "Hub administrators",
  description:
    "Hub administrators can manage this deployment and read its security records. This role never grants access to GitHub repositories.",
  auditLabel: "Security audit",
  auditPath: "/security_audit",
  hubAdminsLabel: "Hub administrators",
  hubAdminsPath: "/hub_admins",
  sharingSettingsLabel: "Public sharing",
  sharingSettingsPath: "/sharing_settings",
  sessionRevocationLabel: "End all Hub sessions",
  sessionRevocationPath: "/session_revocation",
  githubAppLabel: "GitHub App",
  githubAppPath: "/github_app",
  copilotConnectionLabel: "Copilot",
  copilotConnectionPath: "/copilot",
  repositoriesLabel: "Repositories",
  repositoriesPath: "/repositories",
  signOutLabel: "Sign out",
  signOutPath: "/session",
  authenticityToken: "storybook-token",
  notice: null,
  alert: null,
}

export const addHubAdministratorsData = {
  submitPath: "/hub_admins",
  searchPath: "/hub_admins/candidates",
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
}
