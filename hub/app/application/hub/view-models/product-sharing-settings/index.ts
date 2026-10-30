import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { SharingSettingsPageData } from "@pages/sharing-settings-page/types"

import type { WorkspaceResponse } from "../../contracts"
import type { ProductSharingSettings } from "../../product-contracts"

export function productSharingSettingsData(
  workspace: WorkspaceResponse,
  response: ProductSharingSettings,
): SharingSettingsPageData {
  const navigation: HubAdministrationWorkspaceData = {
    accountMenuLabel: `Account menu for @${workspace.viewer.login}`,
    authenticityToken: "",
    collapseNavigationLabel: "Collapse sidebar",
    currentUser: workspace.viewer,
    darkThemeLabel: "Dark",
    expandNavigationLabel: "Expand sidebar",
    feedbackLabel: "Feedback",
    lightThemeLabel: "Light",
    navigationLabel: "Hub administration",
    productName: "Replica Hub",
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    selectedSection: "sharing",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    systemThemeLabel: "System",
    welcomeLabel: "Welcome",
    welcomePath: "/welcome",
    notificationsPath: "/notifications",
    administrationLinks: [
      { section: "admins", label: "Hub administrators", path: "/settings/admins" },
      { section: "sharing", label: "Public sharing", path: "/admin/sharing" },
      { section: "sessions", label: "Session revocation", path: "/settings/sessions" },
      { section: "github", label: "GitHub App", path: "/settings/github" },
      { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
    ],
    securityAuditLabel: "Security audit",
    securityAuditPath: "/settings/audit",
  }
  const common = {
    heading: "Public sharing",
    description:
      "Control signed-out access to synthetic local previews. This is a mock setting, not production authorization or hosting.",
    auditLabel: "Security audit",
    auditPath: "/settings/audit",
    sharingSettingsLabel: "Public sharing",
    sharingSettingsPath: "/admin/sharing",
    repositoriesLabel: "Repositories",
    repositoriesPath: "/",
    signOutLabel: "Sign out",
    signOutPath: "/session",
    authenticityToken: "",
    notice: null,
    alert: null,
  }
  if (!response.canAdminister) {
    return {
      ...common,
      accessDenied: true,
      authenticatedWorkspace: navigation,
      emptyLabel:
        "Only the mock administrator profile can change sharing settings. Select Administrator in the mock controls.",
    }
  }
  return {
    ...common,
    administrationWorkspace: navigation,
    accessDenied: false,
    emptyLabel: "New local share links cannot be created until mock sharing is enabled.",
    statusLabel: response.enabled
      ? "Mock public sharing is enabled"
      : "Mock public sharing is disabled",
    operation: response.enabled ? "disable" : "enable",
    submitPath: "/admin/sharing",
    submitLabel: response.enabled ? "Disable mock public sharing" : "Enable mock public sharing",
    consequence: response.enabled
      ? `All existing local share links will be permanently revoked (${response.activeLinkCount} currently active). Enabling later permits new links only.`
      : "Anyone using a new local link in this mock session can view its fixed synthetic Build without signing in. Previously revoked links stay revoked.",
    confirmLabel: "I understand and confirm this mock sharing change.",
    verification:
      "This is a local mock confirmation. No GitHub verification, authentication, deployment, or token service is called.",
  }
}
