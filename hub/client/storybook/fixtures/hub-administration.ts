import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { HubWorkspaceData } from "@features/hub-workspace/types"

import { signedInRepository, signedInWorkspace } from "./signed-in-workspace"

const repositoryId = signedInRepository.selectedRepositoryId
const repositoryQuery = `repositoryId=${repositoryId}`
const adminsPath = "/settings/administrators"
const sharingPath = "/settings/sharing"
const sessionsPath = "/settings/sessions"
const copilotPath = "/settings/copilot"
const hubAuditPath = "/settings/audit?scope=hub"

export const authenticatedHubWorkspaceData: HubWorkspaceData = {
  ...signedInWorkspace,
  navigationLabel: "Hub navigation",
  emptyRepositoryLabel: "No repository selected",
  repository: {
    ...signedInRepository,
    newPrototypePath: `${signedInRepository.prototypesPath}/new`,
    analyticsLabel: "Analytics",
    analyticsPath: `${signedInRepository.prototypesPath}/analytics`,
  },
  securityAuditLabel: "Security audit",
  securityAuditPath: `/settings/audit?scope=repository&${repositoryQuery}`,
}

export const hubAdministrationWorkspaceData: HubAdministrationWorkspaceData = {
  ...authenticatedHubWorkspaceData,
  navigationLabel: "Repository navigation",
  selectedSection: "admins",
  securityAuditPath: `${hubAuditPath}&${repositoryQuery}`,
  administrationLinks: [
    { section: "admins", label: "Hub administrators", path: `${adminsPath}?${repositoryQuery}` },
    { section: "sharing", label: "Public sharing", path: `${sharingPath}?${repositoryQuery}` },
    {
      section: "sessions",
      label: "End all Hub sessions",
      path: `${sessionsPath}?${repositoryQuery}`,
    },
    { section: "copilot", label: "Copilot connection", path: `${copilotPath}?${repositoryQuery}` },
  ],
}

export const hubAdministrationData = {
  administrationWorkspace: hubAdministrationWorkspaceData,
  heading: "Hub administrators",
  description:
    "Hub administrators can manage this deployment and read its security records. This role never grants access to GitHub repositories.",
  auditLabel: "Security audit",
  auditPath: hubAuditPath,
  hubAdminsLabel: "Hub administrators",
  hubAdminsPath: adminsPath,
  sharingSettingsLabel: "Public sharing",
  sharingSettingsPath: sharingPath,
  sessionRevocationLabel: "End all Hub sessions",
  sessionRevocationPath: sessionsPath,
  copilotConnectionLabel: "Copilot connection",
  copilotConnectionPath: copilotPath,
  repositoriesLabel: "Prototypes",
  repositoriesPath: "/repositories",
  signOutLabel: signedInWorkspace.signOutLabel,
  signOutPath: signedInWorkspace.signOutPath,
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
