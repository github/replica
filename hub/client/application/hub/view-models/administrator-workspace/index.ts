import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"

export function administratorWorkspace(
  session: CurrentHubSession,
  selectedSection: HubAdministrationWorkspaceData["selectedSection"] = "admins",
): HubAdministrationWorkspaceData {
  return {
    accountMenuLabel: `Account menu for @${session.login}`,
    authenticityToken: "",
    collapseNavigationLabel: "Collapse sidebar",
    currentUser: {
      avatarUrl: null,
      login: session.login,
      name: session.name,
    },
    darkThemeLabel: "Dark",
    expandNavigationLabel: "Expand sidebar",
    feedbackLabel: "Feedback",
    lightThemeLabel: "Light",
    navigationLabel: "Hub navigation",
    productName: "Replica Hub",
    repositoriesLabel: "Home",
    repositoriesPath: "/",
    selectedSection,
    settingsNavigationLabel: "Security and settings",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    securityAuditLabel: "Security audit",
    securityAuditPath: "/settings/audit?scope=hub",
    systemThemeLabel: "System",
    administrationLinks: [
      {
        section: "admins",
        label: "Hub administrators",
        path: "/settings/administrators",
      },
      {
        section: "sessions",
        label: "End all Hub sessions",
        path: "/settings/sessions",
      },
    ],
  }
}
