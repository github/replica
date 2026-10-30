export interface WorkspaceAccountData {
  accountMenuLabel: string
  authenticityToken: string
  collapseNavigationLabel: string
  expandNavigationLabel: string
  feedbackLabel: string
  currentUser: {
    avatarUrl: string | null
    login: string
    name: string | null
  }
  darkThemeLabel: string
  lightThemeLabel: string
  signOutLabel: string
  signOutPath: string
  systemThemeLabel: string
}
