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
      { section: "sessions", label: "End all Hub sessions", path: "/settings/sessions" },
      { section: "github", label: "GitHub App", path: "/settings/github" },
      { section: "copilot", label: "Copilot connection", path: "/settings/copilot" },
    ],
    securityAuditLabel: "Security audit",
    securityAuditPath: "/settings/audit",
  }
  const common = {
    heading: "Public sharing",
    description:
      "Control anonymous access to shared prototype Builds. This setting does not grant repository access.",
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
      emptyLabel: "Only Hub administrators can view or change deployment sharing settings.",
    }
  }
  return {
    ...common,
    administrationWorkspace: navigation,
    accessDenied: false,
    emptyLabel:
      "No public access is permitted until a Hub administrator explicitly enables sharing.",
    statusLabel: response.enabled ? "Public sharing is enabled" : "Public sharing is disabled",
    operation: response.enabled ? "disable" : "enable",
    submitPath: "/admin/sharing",
    submitLabel: response.enabled ? "Disable public sharing" : "Enable public sharing",
    consequence: response.enabled
      ? "All existing share links will be permanently revoked, including open previews and pending handoffs. Enabling later permits new links only."
      : "Anyone with a new share link can view its fixed Build without signing in. Previously revoked links stay revoked.",
    confirmLabel: "I understand and confirm this deployment-wide change.",
    verification:
      "This change requires GitHub verification within the last five minutes on this browser. If verification is required, Hub continues your confirmed change after it succeeds.",
  }
}
