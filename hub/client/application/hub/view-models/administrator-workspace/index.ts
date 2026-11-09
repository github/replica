import type { HubAdministrationWorkspaceData } from "@features/hub-administration-workspace/types"
import type { CurrentHubSession } from "@application/hub/administrator-contracts/types"

export function administratorWorkspace(session: CurrentHubSession): HubAdministrationWorkspaceData {
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
    selectedSection: "admins",
    settingsNavigationLabel: "Security and settings",
    signOutLabel: "Sign out",
    signOutPath: "/api/auth/session/sign-out",
    systemThemeLabel: "System",
    administrationLinks: [
      {
        section: "admins",
        label: "Hub administrators",
        path: "/settings/administrators",
      },
    ],
  }
}
